import type { ArtifactApprovalState, Gate } from '../gates/GateEnforcer.js';

export type Decision = 'approved' | 'rejected';

export interface GovernanceStore {
  submit(i: { artifactId: string; createdBy: string; cqlLibraryUrl?: string; version?: string }): Promise<{ created: boolean }>;
  get(artifactId: string): Promise<ArtifactApprovalState | undefined>;
  recordApproval(r: { artifactId: string; gate: Gate; approver: string; decision: Decision; recordedAt: string }): Promise<void>;
  markActivated(artifactId: string): Promise<void>;
  list(): Promise<ArtifactApprovalState[]>;
}
