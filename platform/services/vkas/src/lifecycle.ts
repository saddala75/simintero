export type ArtifactStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "active"
  | "retired"
  | "rolled_back";

const ALLOWED_TRANSITIONS: Record<ArtifactStatus, ArtifactStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],         // can send back to draft for revision
  approved: ["active", "in_review"],        // can send back for re-review
  active: ["retired", "rolled_back"],
  retired: [],
  rolled_back: [],
};

export class StatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "StatusTransitionError";
  }
}

export function transitionStatus(
  from: ArtifactStatus,
  to: ArtifactStatus
): ArtifactStatus {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new StatusTransitionError(from, to);
  }
  return to;
}
