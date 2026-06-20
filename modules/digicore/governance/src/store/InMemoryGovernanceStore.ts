import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';
import type { GovernanceStore } from './GovernanceStore.js';

export class InMemoryGovernanceStore implements GovernanceStore {
  private map = new Map<string, ArtifactApprovalState>();
  readonly events: { schemaRef: string; payload: Record<string, unknown> }[] = [];

  async submit(i: { artifactId: string; createdBy: string; cqlLibraryUrl?: string; version?: string }): Promise<{ created: boolean }> {
    if (this.map.has(i.artifactId)) return { created: false };
    const state: ArtifactApprovalState = { artifact_id: i.artifactId, created_by: i.createdBy, approvals: [] };
    if (i.cqlLibraryUrl !== undefined) state.cql_library_url = i.cqlLibraryUrl;
    if (i.version !== undefined) state.version = i.version;
    this.map.set(i.artifactId, state);
    return { created: true };
  }

  async get(artifactId: string): Promise<ArtifactApprovalState | undefined> {
    const s = this.map.get(artifactId);
    return s ? structuredClone(s) : undefined;
  }

  async recordApproval(r: { artifactId: string; gate: 'clinical' | 'compliance'; approver: string; decision: 'approved' | 'rejected'; recordedAt: string }): Promise<void> {
    const s = this.map.get(r.artifactId);
    if (!s) throw new Error(`unknown artifact ${r.artifactId}`);
    s.approvals.push({ gate: r.gate, approver: r.approver, decision: r.decision, recorded_at: r.recordedAt });
    this.events.push({ schemaRef: 'sim.artifact/ApprovalRecorded/v1', payload: { artifact_id: r.artifactId, gate: r.gate, decision: r.decision } });
  }

  async markActivated(artifactId: string): Promise<void> {
    const s = this.map.get(artifactId);
    if (!s) throw new Error(`unknown artifact ${artifactId}`);
    s.activated_at = new Date().toISOString();
    this.events.push({ schemaRef: 'sim.artifact/Activated/v1', payload: { artifact_id: artifactId } });
  }

  async list(): Promise<ArtifactApprovalState[]> {
    return Array.from(this.map.values()).map(s => structuredClone(s));
  }
}
