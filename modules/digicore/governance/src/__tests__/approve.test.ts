import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApprove } from '../routes/approve.js';
import type { ApproveInput } from '../routes/approve.js';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import { GovernanceNotifier } from '../notifications/GovernanceNotifier.js';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';

describe('handleApprove', () => {
  let store: Map<string, ArtifactApprovalState>;
  let enforcer: GateEnforcer;
  let notifier: GovernanceNotifier;
  let emitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new Map<string, ArtifactApprovalState>();
    store.set('artifact-1', {
      artifact_id: 'artifact-1',
      created_by: 'author-1',
      approvals: [],
    });

    enforcer = new GateEnforcer();

    emitSpy = vi.fn().mockResolvedValue(undefined);
    notifier = new GovernanceNotifier({ emit: emitSpy });
  });

  it('recording clinical gate updates approval state and does NOT trigger activation', async () => {
    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    };

    const result = await handleApprove(input, store, enforcer, notifier);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      recorded: true,
      gate: 'clinical',
      decision: 'approved',
    });

    const state = store.get('artifact-1');
    expect(state?.approvals).toHaveLength(1);
    expect(state?.approvals.at(0)).toMatchObject({
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    });

    // Should call notifyApproval (emit with approval_recorded event), NOT notifyActivation
    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'sim.artifact.approval_recorded',
        artifact_id: 'artifact-1',
        gate: 'clinical',
        decision: 'approved',
      }),
    );
  });

  it('returns 403 with SIM-GOV-SOD code when approver equals author', async () => {
    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'author-1', // same as created_by
    };

    const result = await handleApprove(input, store, enforcer, notifier);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'SIM-GOV-SOD' });
    // Store must not be mutated on SOD violation
    expect(store.get('artifact-1')?.approvals).toHaveLength(0);
    // Notifier must not be called
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns 409 when the same gate is recorded a second time', async () => {
    // Pre-record clinical gate
    const state = store.get('artifact-1');
    state!.approvals.push({
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recorded_at: new Date().toISOString(),
    });

    const input: ApproveInput = {
      artifact_id: 'artifact-1',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-2',
    };

    const result = await handleApprove(input, store, enforcer, notifier);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: expect.stringContaining('already approved') });
    // Approval count must remain 1 — no duplicate push
    expect(store.get('artifact-1')?.approvals).toHaveLength(1);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact is not in the store', async () => {
    const input: ApproveInput = {
      artifact_id: 'nonexistent',
      gate: 'clinical',
      decision: 'approved',
      approver: 'reviewer-1',
    };

    const result = await handleApprove(input, store, enforcer, notifier);

    expect(result.status).toBe(404);
  });
});
