import type { CaseState, CaseEvent } from './types.js';

/**
 * Pure reducer — no side effects, no DB access.
 * Applies a single CaseEvent to CaseState and returns the next state.
 */
export function reduce(state: CaseState, event: CaseEvent): CaseState {
  switch (event.type) {
    case 'CaseCreated':
      // CaseCreated is the bootstrap event; state is already seeded from the INSERT
      return {
        ...state,
        events: [...state.events, event],
      };

    case 'CaseStateChanged':
      return {
        ...state,
        status: event.to,
        events: [...state.events, event],
      };

    case 'DeterminationRecorded':
      // Status transition to 'determined' is driven by a CaseStateChanged event separately
      return {
        ...state,
        events: [...state.events, event],
      };

    case 'PinAppended':
      return {
        ...state,
        pins: [...state.pins, { canonical_url: event.canonical_url, version: event.version }],
        events: [...state.events, event],
      };

    case 'CaseLinked':
      return {
        ...state,
        linked: event.payload['linked'] as typeof state.linked,
        events: [...state.events, event],
      };

    case 'RfiIssued':
      return {
        ...state,
        events: [...state.events, event],
      };

    case 'RfiSatisfied':
      return {
        ...state,
        events: [...state.events, event],
      };

    default: {
      // Exhaustive check — TypeScript will error if a new event type is added
      // without handling it here
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Replay all events in order to reconstruct CaseState.
 * Requires an initial seed state (from the ens.case row).
 */
export function replayEvents(seed: CaseState, events: CaseEvent[]): CaseState {
  return events.reduce(reduce, seed);
}
