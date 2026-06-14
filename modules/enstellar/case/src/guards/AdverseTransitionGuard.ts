// Port of Enstellar Python engine/guards.py
// INVARIANT #1: No adverse outcome without clinician sign-off. NOT configurable.
export const ADVERSE_STATES = new Set<string>([
  'denied',
  'partially_denied',
  'adverse_modification',
]);

export class TransitionGuardError extends Error {
  readonly code = 'SIM-GUARD-0001';
  readonly status = 403;
  constructor(reason: string) {
    super(reason);
    this.name = 'TransitionGuardError';
  }
}

export function adverseTransitionGuard(
  toState: string,
  humanSignoffRecorded: boolean,
): void {
  if (ADVERSE_STATES.has(toState) && !humanSignoffRecorded) {
    throw new TransitionGuardError(
      `transition to '${toState}' requires human sign-off — invariant #1`
    );
  }
}
