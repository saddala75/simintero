export type TaskStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'resolved', 'cancelled'],
  in_progress: ['resolved', 'cancelled', 'open'],
  resolved: [],
  cancelled: [],
};

export class StatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid task status transition: ${from} → ${to}`);
    this.name = 'StatusTransitionError';
  }
}

export function transitionStatus(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!ALLOWED[from]?.includes(to)) throw new StatusTransitionError(from, to);
  return to;
}
