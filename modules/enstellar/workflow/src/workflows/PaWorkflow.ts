/**
 * PaWorkflow — Temporal workflow for prior-auth lifecycle.
 *
 * Interprets the pa-standard-ma.yaml state machine and orchestrates:
 *   1. Resolve workflow_def from VKAS
 *   2. Run coverage discovery → populate entitlements
 *   3. Run completeness check (C-1) if DIG entitlement present
 *   4. Route to pend_rfi (create RFI) or clinical_review
 *   5. At pend_rfi: await rfiSatisfiedSignal or deadline timeout
 *   6. At clinical_review: routeToReviewer, await decisionRecordedSignal
 *   7. Reach determined terminal state
 *
 * SANDBOX RULES:
 *  - No node:* imports
 *  - No direct network / fs calls
 *  - CelGuardEvaluator is importable (pure, no I/O)
 *  - Activities proxied via proxyActivities()
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
} from '@temporalio/workflow';

import type * as activitiesModule from '../activities/index.js';
import { evaluateGuard } from '../guards/CelGuardEvaluator.js';
import type { PaWorkflowState, PaWorkflowStatus } from './PaWorkflowState.js';

// ---------------------------------------------------------------------------
// Activity proxy
// ---------------------------------------------------------------------------

const {
  resolveWorkflowDef,
  callRuntimeEvaluate,
  callCoverageDiscovery,
  createRfi,
  routeToReviewer,
  recordAutoDetermination,
  requestAdvisoryAnalysis,
  emitCaseTransition,
} = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '2s',
  retry: {
    initialInterval: '500ms',
    maximumAttempts: 3,
    backoffCoefficient: 2,
  },
});

// ---------------------------------------------------------------------------
// Signals & queries
// ---------------------------------------------------------------------------

export const withdrawSignal = defineSignal<[{ reason: string }]>('withdraw');
export const rfiSatisfiedSignal = defineSignal<[{ rfiId: string }]>('rfi_satisfied');
export const decisionRecordedSignal = defineSignal<[{ outcome: string }]>('decision_recorded');

export const statusQuery = defineQuery<PaWorkflowStatus>('status');

// ---------------------------------------------------------------------------
// Workflow input
// ---------------------------------------------------------------------------

export interface PaWorkflowInput {
  caseId: string;
  tenantId: string;
  urgency: 'standard' | 'expedited';
}

// ---------------------------------------------------------------------------
// Workflow function
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: PaWorkflowStatus[] = ['determined', 'withdrawn', 'voided'];

export async function PaWorkflow(input: PaWorkflowInput): Promise<PaWorkflowState> {
  const state: PaWorkflowState = {
    caseId: input.caseId,
    tenantId: input.tenantId,
    status: 'intake',
    urgency: input.urgency,
    workflowDefPin: null,
    clockProfilePin: null,
    entitlements: {},
    autoEligible: false,
  };

  // Mutable signal state (mutated by handlers)
  let withdrawReason: string | null = null;
  let rfiSatisfied = false;
  let decisionOutcome: string | null = null;

  // Register signal handlers
  setHandler(withdrawSignal, ({ reason }) => {
    if (!TERMINAL_STATUSES.includes(state.status)) {
      withdrawReason = reason;
    }
  });

  setHandler(rfiSatisfiedSignal, () => {
    rfiSatisfied = true;
  });

  setHandler(decisionRecordedSignal, ({ outcome }) => {
    decisionOutcome = outcome;
  });

  // Register status query
  setHandler(statusQuery, () => state.status);

  // -------------------------------------------------------------------------
  // Step 1: Resolve workflow definition
  // -------------------------------------------------------------------------
  const defResult = await resolveWorkflowDef({ caseId: state.caseId });
  state.workflowDefPin = defResult.pin;

  if (withdrawReason !== null) {
    state.status = 'withdrawn';
    await emitCaseTransition({
      caseId: state.caseId,
      tenantId: state.tenantId,
      from: 'intake',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
    });
    return state;
  }

  // -------------------------------------------------------------------------
  // Step 2: intake → completeness_check  (trigger: case.created)
  // -------------------------------------------------------------------------
  state.status = 'completeness_check';
  await emitCaseTransition({
    caseId: state.caseId,
    tenantId: state.tenantId,
    from: 'intake',
    to: 'completeness_check',
    trigger: 'case.created',
  });

  // Coverage discovery — populate entitlements
  const coverageResult = await callCoverageDiscovery({
    caseId: state.caseId,
    tenantId: state.tenantId,
  });
  state.entitlements = coverageResult.entitlements;

  // Advisory analysis — non-blocking, result discarded (advisory-only)
  await requestAdvisoryAnalysis({
    caseId: state.caseId,
    documentRefs: [],
    lob: '',
    urgency: state.urgency,
  });

  if (withdrawReason !== null) {
    state.status = 'withdrawn';
    await emitCaseTransition({
      caseId: state.caseId,
      tenantId: state.tenantId,
      from: 'completeness_check',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
    });
    return state;
  }

  // -------------------------------------------------------------------------
  // Step 3: Completeness check via C-1 (guard: DIG entitlement)
  // -------------------------------------------------------------------------
  let gaps: string[] = [];

  // CEL expressions use 'entitlement' as the root namespace; wrap accordingly
  const digGuard = 'entitlement.module.DIG.enabled == true';
  const celContext = { entitlement: state.entitlements };
  const digEnabled = evaluateGuard(digGuard, celContext);

  if (digEnabled) {
    const evalResult = await callRuntimeEvaluate({
      caseId: state.caseId,
      policyRefs: [],
    });
    state.autoEligible = evalResult.eligible;
    gaps = evalResult.gaps;
  }

  if (withdrawReason !== null) {
    state.status = 'withdrawn';
    await emitCaseTransition({
      caseId: state.caseId,
      tenantId: state.tenantId,
      from: 'completeness_check',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
    });
    return state;
  }

  // -------------------------------------------------------------------------
  // Step 4: Route based on completeness
  // -------------------------------------------------------------------------
  if (gaps.length > 0) {
    // completeness.gap_found → pend_rfi
    state.status = 'pend_rfi';
    await emitCaseTransition({
      caseId: state.caseId,
      tenantId: state.tenantId,
      from: 'completeness_check',
      to: 'pend_rfi',
      trigger: 'completeness.gap_found',
    });

    await createRfi({
      caseId: state.caseId,
      tenantId: state.tenantId,
      gaps,
    });

    // RFI deadline: 72h standard, 24h expedited (statutory PA clock)
    const rfiDeadlineMs =
      state.urgency === 'expedited'
        ? 24 * 60 * 60 * 1000
        : 72 * 60 * 60 * 1000;

    const resolved = await condition(
      () => rfiSatisfied || withdrawReason !== null,
      rfiDeadlineMs,
    );

    if (withdrawReason !== null) {
      state.status = 'withdrawn';
      await emitCaseTransition({
        caseId: state.caseId,
        tenantId: state.tenantId,
        from: 'pend_rfi',
        to: 'withdrawn',
        trigger: 'member.withdrawal',
      });
      return state;
    }

    if (!resolved) {
      // rfi.deadline_expired → determined
      state.status = 'determined';
      await emitCaseTransition({
        caseId: state.caseId,
        tenantId: state.tenantId,
        from: 'pend_rfi',
        to: 'determined',
        trigger: 'rfi.deadline_expired',
      });
      return state;
    }
    // rfi.satisfied → fall through to clinical_review
  }

  // completeness.complete or rfi.satisfied → clinical_review
  const fromForClinical = state.status; // 'completeness_check' or 'pend_rfi'
  const clinicalTrigger =
    fromForClinical === 'pend_rfi' ? 'rfi.satisfied' : 'completeness.complete';
  state.status = 'clinical_review';
  await emitCaseTransition({
    caseId: state.caseId,
    tenantId: state.tenantId,
    from: fromForClinical,
    to: 'clinical_review',
    trigger: clinicalTrigger,
  });

  // -------------------------------------------------------------------------
  // Step 5: Route to reviewer, wait for decision
  // -------------------------------------------------------------------------
  await routeToReviewer({
    caseId: state.caseId,
    tenantId: state.tenantId,
    urgency: state.urgency,
  });

  await condition(() => decisionOutcome !== null || withdrawReason !== null);

  if (withdrawReason !== null) {
    state.status = 'withdrawn';
    await emitCaseTransition({
      caseId: state.caseId,
      tenantId: state.tenantId,
      from: 'clinical_review',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
    });
    return state;
  }

  // -------------------------------------------------------------------------
  // Step 6: Determined
  // -------------------------------------------------------------------------
  state.status = 'determined';
  await emitCaseTransition({
    caseId: state.caseId,
    tenantId: state.tenantId,
    from: 'clinical_review',
    to: 'determined',
    trigger: 'decision.recorded',
  });

  // Auto-determination: approved-only, requires eligible=true
  if (decisionOutcome === 'approved' && state.autoEligible) {
    await recordAutoDetermination({
      caseId: state.caseId,
      tenantId: state.tenantId,
      outcome: decisionOutcome,
      eligible: state.autoEligible,
    });
  }

  return state;
}

// Needed for Temporal worker bundle (unused import elimination guard)
void sleep; // eslint-disable-line @typescript-eslint/no-unused-expressions
