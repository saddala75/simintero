// Aggregate
export type { CaseState, CaseEvent, CaseStatus, DeterminationOutcome } from './aggregate/types.js';
export type {
  DeterminationDecidedBy,
  RecordDecisionInput,
  CreateCaseInput,
  RecordRFIInput,
  SatisfyRFIInput,
  AppendPinInput,
  LinkCaseInput,
} from './aggregate/types.js';
export { reduce, replayEvents } from './aggregate/reducers.js';
export { Case } from './aggregate/Case.js';

// Commands
export { createCase } from './commands/CreateCase.js';
export type { CreateCaseResult } from './commands/CreateCase.js';
export { recordDecision } from './commands/RecordDecision.js';
export type { RecordDecisionResult } from './commands/RecordDecision.js';
export { appendPin } from './commands/AppendPin.js';
export type { AppendPinResult } from './commands/AppendPin.js';
export { recordRFI } from './commands/RecordRFI.js';
export type { RecordRFIResult } from './commands/RecordRFI.js';
export { satisfyRFI } from './commands/SatisfyRFI.js';
export type { SatisfyRFIResult } from './commands/SatisfyRFI.js';
export { linkCase } from './commands/LinkCase.js';
export type { LinkCaseResult } from './commands/LinkCase.js';

// Guards
export { adverseTransitionGuard, ADVERSE_STATES, TransitionGuardError } from './guards/AdverseTransitionGuard.js';

// Projections
export { getWorklist } from './projections/worklist.js';
export type { WorklistEntry } from './projections/worklist.js';
export { getCaseDetail } from './projections/caseDetail.js';
export type { CaseDetailResult, ServiceLine, Determination } from './projections/caseDetail.js';

// Event store
export { CaseEventStore } from './events/CaseEventStore.js';
export type { StoredEvent } from './events/CaseEventStore.js';
