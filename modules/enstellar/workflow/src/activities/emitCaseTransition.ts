/**
 * Activity: emitCaseTransition
 * Called by PaWorkflow immediately after each state.status mutation.
 * Delegates to emitTransitionEvent which POSTs to the case-service outbox endpoint.
 */
import { emitTransitionEvent } from './emitTransitionEvent.js';

export interface EmitCaseTransitionInput {
  caseId: string;
  tenantId: string;
  from: string;
  to: string;
  trigger: string;
}

export async function emitCaseTransition(input: EmitCaseTransitionInput): Promise<void> {
  await emitTransitionEvent({
    caseId: input.caseId,
    tenantId: input.tenantId,
    fromState: input.from,
    toState: input.to,
    trigger: input.trigger,
  });
}
