import { describe, it, expect, beforeEach } from 'vitest';
import { handleApprove } from '../routes/approve.js';
import type { ApproveInput } from '../routes/approve.js';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import { InMemoryGovernanceStore } from '../store/InMemoryGovernanceStore.js';

describe('handleApprove', () => {
  let store: InMemoryGovernanceStore;
  let enforcer: GateEnforcer;

  beforeEach(async () => {
    store = new InMemoryGovernanceStore();
    await store.submit({ artifactId: 'artifact-1', createdBy: 'author-1' });

    enforcer = new GateEnforcer();
  });

  it('recording clinical gate updates approval state and does NOT trigger activation', async () => {
    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    };

    const result = await handleApprove(input, store, enforcer);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      recorded: true,
      gate: 'clinical',
      decision: 'approved',
    });

    const state = await store.get('artifact-1');
    expect(state?.approvals).toHaveLength(1);
    expect(state?.approvals.at(0)).toMatchObject({
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    });

    // Should emit an ApprovalRecorded event, NOT an Activated event
    expect(store.events.map(e => e.schemaRef)).toEqual([
      'sim.artifact/ApprovalRecorded/v1',
    ]);
    expect(store.events.at(0)?.payload).toMatchObject({
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
    });
  });

  it('returns 403 with SIM-GOV-SOD code when approver equals author', async () => {
    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'author-1', // same as created_by
    };

    const result = await handleApprove(input, store, enforcer);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'SIM-GOV-SOD' });
    // Store must not be mutated on SOD violation
    expect((await store.get('artifact-1'))?.approvals).toHaveLength(0);
    // No event must be emitted
    expect(store.events).toHaveLength(0);
  });

  it('returns 409 when the same gate is recorded a second time', async () => {
    // Pre-record clinical gate
    await store.recordApproval({
      artifactId: 'artifact-1',
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });
    const eventsBefore = store.events.length;

    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-2',
    };

    const result = await handleApprove(input, store, enforcer);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: expect.stringContaining('already approved') });
    // Approval count must remain 1 — no duplicate push
    expect((await store.get('artifact-1'))?.approvals).toHaveLength(1);
    // No new event must be emitted by the rejected re-approval
    expect(store.events).toHaveLength(eventsBefore);
  });

  it('returns 404 when artifact is not in the store', async () => {
    const input: ApproveInput = {
      artifact_id: 'nonexistent',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    };

    const result = await handleApprove(input, store, enforcer);

    expect(result.status).toBe(404);
  });
});
