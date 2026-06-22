import { describe, it, expect } from 'vitest';
import { InMemoryGovernanceStore } from '../store/InMemoryGovernanceStore.js';

describe('InMemoryGovernanceStore', () => {
  it('submit is idempotent and get returns the assembled state', async () => {
    const s = new InMemoryGovernanceStore();
    expect((await s.submit({ artifactId: 'a', createdBy: 'x', cqlLibraryUrl: 'cql', version: '1.0.0' })).created).toBe(true);
    expect((await s.submit({ artifactId: 'a', createdBy: 'x' })).created).toBe(false);
    const st = await s.get('a');
    expect(st).toMatchObject({ artifact_id: 'a', created_by: 'x', cql_library_url: 'cql', version: '1.0.0', approvals: [] });
  });

  it('recordApproval appends + captures an event; markActivated sets activated_at + event', async () => {
    const s = new InMemoryGovernanceStore();
    await s.submit({ artifactId: 'a', createdBy: 'x' });
    await s.recordApproval({ artifactId: 'a', gate: 'clinical', approver: 'rev-a', decision: 'approved', recordedAt: '2026-01-01T00:00:00Z' });
    expect((await s.get('a'))!.approvals).toEqual([{ gate: 'clinical', approver: 'rev-a', decision: 'approved', recorded_at: '2026-01-01T00:00:00Z' }]);
    await s.markActivated('a');
    expect((await s.get('a'))!.activated_at).toBeDefined();
    expect(s.events.map(e => e.schemaRef)).toEqual(['sim.artifact/ApprovalRecorded/v1', 'sim.artifact/Activated/v1']);
  });
});
