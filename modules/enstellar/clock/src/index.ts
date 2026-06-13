/**
 * Public API surface of @sim/enstellar-clock.
 */
export { ClockWorkflow, advanceClockState, initialClockMachineState } from './workflows/ClockWorkflow.js';
export type { ClockInput, ClockState, ClockMachineState, ClockMachineEvent } from './workflows/ClockWorkflow.js';

export { pauseClockSignal, resumeClockSignal, satisfyClockSignal } from './signals/index.js';

export { computeDeadline, computeDeadlineActivity } from './activities/computeDeadline.js';
export type { DeadlineInput, LimitValue } from './activities/computeDeadline.js';

export { resolveClockProfile } from './activities/resolveClockProfile.js';
export type { ClockProfile, ClockProfileEntry } from './activities/resolveClockProfile.js';

export { emitWarning } from './activities/emitWarning.js';
export type { EmitWarningParams } from './activities/emitWarning.js';

export { emitBreach } from './activities/emitBreach.js';
export type { EmitBreachParams } from './activities/emitBreach.js';

export { getClocksByCase, getClockById } from './projections/clockState.js';
export type { ClockRow, DbClient } from './projections/clockState.js';
