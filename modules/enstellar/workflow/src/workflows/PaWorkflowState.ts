export type PaWorkflowStatus =
  | 'intake'
  | 'completeness_check'
  | 'pend_rfi'
  | 'clinical_review'
  | 'determined'
  | 'withdrawn'
  | 'voided';

export interface PaWorkflowState {
  caseId: string;
  tenantId: string;
  status: PaWorkflowStatus;
  urgency: 'standard' | 'expedited';
  workflowDefPin: { canonical_url: string; version: string } | null;
  clockProfilePin: { canonical_url: string; version: string } | null;
  entitlements: Record<string, unknown>; // from coverage discovery
  autoEligible: boolean; // from C-1 evaluate
}

export type PaWorkflowTrigger =
  | 'case.created'
  | 'completeness.gap_found'
  | 'completeness.complete'
  | 'rfi.satisfied'
  | 'rfi.deadline_expired'
  | 'decision.recorded'
  | 'member.withdrawal'
  | 'case.duplicate_detected';

const TERMINAL_STATES: PaWorkflowStatus[] = ['determined', 'withdrawn', 'voided'];

/**
 * Pure state-transition function for the pa-standard-ma state machine.
 * Extracted for unit-testability without Temporal infrastructure.
 * Returns the new status or null if the transition is invalid.
 */
export function advanceState(
  current: PaWorkflowStatus,
  trigger: PaWorkflowTrigger,
): PaWorkflowStatus | null {
  // Withdrawal from any non-terminal state
  if (trigger === 'member.withdrawal') {
    if (TERMINAL_STATES.includes(current)) return null;
    return 'withdrawn';
  }

  // Void from intake or completeness_check
  if (trigger === 'case.duplicate_detected') {
    if (current === 'intake' || current === 'completeness_check') return 'voided';
    return null;
  }

  switch (current) {
    case 'intake':
      if (trigger === 'case.created') return 'completeness_check';
      return null;

    case 'completeness_check':
      if (trigger === 'completeness.gap_found') return 'pend_rfi';
      if (trigger === 'completeness.complete') return 'clinical_review';
      return null;

    case 'pend_rfi':
      if (trigger === 'rfi.satisfied') return 'clinical_review';
      if (trigger === 'rfi.deadline_expired') return 'determined';
      return null;

    case 'clinical_review':
      if (trigger === 'decision.recorded') return 'determined';
      return null;

    case 'determined':
    case 'withdrawn':
    case 'voided':
      return null; // terminal — no further transitions

    default:
      return null;
  }
}

export function isTerminal(status: PaWorkflowStatus): boolean {
  return TERMINAL_STATES.includes(status);
}
