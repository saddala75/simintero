/**
 * ClockWorkflow — Temporal workflow: one per clock per case.
 *
 * SANDBOX RULES:
 *  - No node:* imports
 *  - No direct network / fs calls
 *  - Activities proxied via proxyActivities()
 *  - Signal definitions imported from signals/ (pure defineSignal calls — safe)
 *
 * The pure state machine logic is also exported as advanceClockState()
 * so tests can exercise it without a Temporal server.
 */

import {
  proxyActivities,
  setHandler,
  condition,
} from '@temporalio/workflow';

import { pauseClockSignal, resumeClockSignal, satisfyClockSignal } from '../signals/index.js';
import type * as activitiesModule from '../activities/index.js';

// ---------------------------------------------------------------------------
// Activity proxy
// ---------------------------------------------------------------------------

const { computeDeadlineActivity, emitWarning, emitBreach } =
  proxyActivities<typeof activitiesModule>({
    startToCloseTimeout: '5s',
    retry: {
      initialInterval: '500ms',
      maximumAttempts: 3,
      backoffCoefficient: 2,
    },
  });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClockState = 'running' | 'paused' | 'satisfied' | 'breached';

export interface ClockInput {
  caseId: string;
  tenantId: string;
  clockType: 'standard' | 'expedited' | 'rfi_hold' | 'appeal';
  startedAt: string; // ISO-8601
  limitValue: { value: number; unit: 'business_days' | 'hours' | 'calendar_days' };
  warningThresholdPct: number;
}

// ---------------------------------------------------------------------------
// Pure state machine — exported for unit tests (no Temporal dependencies)
// ---------------------------------------------------------------------------

export interface ClockMachineState {
  satisfied: boolean;
  paused: boolean;
  elapsedBanked: number; // milliseconds
  pauseStart: number | null;
}

export type ClockMachineEvent =
  | { type: 'satisfy' }
  | { type: 'pause'; pausedAt: number }
  | { type: 'resume'; resumedAt: number };

/**
 * Pure function: apply a single event to the clock machine state.
 * Returns a new state object; never mutates the input.
 */
export function advanceClockState(
  state: ClockMachineState,
  event: ClockMachineEvent,
): ClockMachineState {
  switch (event.type) {
    case 'satisfy': {
      return { ...state, satisfied: true };
    }
    case 'pause': {
      if (state.paused || state.satisfied) return state;
      return { ...state, paused: true, pauseStart: event.pausedAt };
    }
    case 'resume': {
      if (!state.paused || state.pauseStart === null) return state;
      const banked = state.elapsedBanked + (event.resumedAt - state.pauseStart);
      return { ...state, paused: false, pauseStart: null, elapsedBanked: banked };
    }
    default: {
      return state;
    }
  }
}

export function initialClockMachineState(): ClockMachineState {
  return {
    satisfied: false,
    paused: false,
    elapsedBanked: 0,
    pauseStart: null,
  };
}

// ---------------------------------------------------------------------------
// Workflow function
// ---------------------------------------------------------------------------

export async function ClockWorkflow(input: ClockInput): Promise<void> {
  // Mutable workflow state
  let satisfied = false;
  let paused = false;
  let elapsedBanked = 0; // milliseconds
  let pauseStart: number | null = null;

  // Signal handlers
  setHandler(satisfyClockSignal, () => {
    satisfied = true;
  });

  setHandler(pauseClockSignal, ({ pausedAt }) => {
    if (!paused && !satisfied) {
      paused = true;
      pauseStart = new Date(pausedAt).getTime();
    }
  });

  setHandler(resumeClockSignal, ({ resumedAt }) => {
    if (paused && pauseStart !== null) {
      elapsedBanked += new Date(resumedAt).getTime() - pauseStart;
      paused = false;
      pauseStart = null;
    }
  });

  // Compute deadline
  const started = new Date(input.startedAt).getTime();
  const deadlineIso = await computeDeadlineActivity(input.limitValue, input.startedAt);
  const totalMs = new Date(deadlineIso).getTime() - started;
  const warningMs = totalMs * input.warningThresholdPct;

  // Wait for warning threshold (accounting for banked pause time and live pause)
  while (!satisfied) {
    const livePauseMs = (paused && pauseStart !== null) ? (Date.now() - pauseStart) : 0;
    const elapsed = Date.now() - started - elapsedBanked - livePauseMs;
    if (elapsed >= warningMs) break;
    const remaining = warningMs - elapsed;
    const reached = await condition(
      () => satisfied || (!paused && (Date.now() - started - elapsedBanked >= warningMs)),
      remaining,
    );
    if (satisfied) break;
    if (reached) break;
  }

  if (!satisfied) {
    await emitWarning({
      caseId: input.caseId,
      tenantId: input.tenantId,
      clockType: input.clockType,
    });
  }

  // Wait for deadline (accounting for banked pause time and live pause)
  while (!satisfied) {
    const livePauseMs = (paused && pauseStart !== null) ? (Date.now() - pauseStart) : 0;
    const elapsed = Date.now() - started - elapsedBanked - livePauseMs;
    if (elapsed >= totalMs) break;
    const remaining = totalMs - elapsed;
    await condition(() => satisfied, remaining);
  }

  // Emit breach if clock expired without satisfaction
  if (!satisfied) {
    await emitBreach({
      caseId: input.caseId,
      tenantId: input.tenantId,
      clockType: input.clockType,
    });
  }
}
