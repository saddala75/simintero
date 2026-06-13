import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleActivate } from '../routes/activate.js';
import type { ActivateInput, VkasClient } from '../routes/activate.js';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import { GovernanceNotifier } from '../notifications/GovernanceNotifier.js';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';

describe('handleActivate', () => {
  let store: Map<string, ArtifactApprovalState>;
  let enforcer: GateEnforcer;
  let notifier: GovernanceNotifier;
  let vkasClient: VkasClient;
  let vkasActivateSpy: ReturnType<typeof vi.fn>;
  let emitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new Map<string, ArtifactApprovalState>();
    enforcer = new GateEnforcer();

    vkasActivateSpy = vi.fn().mockResolvedValue(undefined);
    vkasClient = { activate: vkasActivateSpy };

    emitSpy = vi.fn().mockResolvedValue(undefined);
    notifier = new GovernanceNotifier({ emit: emitSpy });
  });

  it('calls VkasClient.activate() and emits notifyActivation when both gates are approved', async () => {
    store.set('artifact-2', {
      artifact_id: 'artifact-2',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
        {
          gate: 'compliance',
          approver: 'officer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
    });

    const input: ActivateInput = { artifact_id: 'artifact-2' };
    const result = await handleActivate(input, store, enforcer, vkasClient, notifier);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ activated: true, artifact_id: 'artifact-2' });

    expect(vkasActivateSpy).toHaveBeenCalledOnce();
    expect(vkasActivateSpy).toHaveBeenCalledWith('artifact-2');

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'sim.artifact.activated',
        artifact_id: 'artifact-2',
      }),
    );
  });

  it('returns 409 with missingGates when only clinical gate is approved', async () => {
    store.set('artifact-3', {
      artifact_id: 'artifact-3',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
    });

    const input: ActivateInput = { artifact_id: 'artifact-3' };
    const result = await handleActivate(input, store, enforcer, vkasClient, notifier);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: expect.stringContaining('gates must be approved'),
      missingGates: ['compliance'],
    });
    expect(vkasActivateSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns 409 with both missingGates when no gates are approved', async () => {
    store.set('artifact-4', {
      artifact_id: 'artifact-4',
      created_by: 'author-1',
      approvals: [],
    });

    const input: ActivateInput = { artifact_id: 'artifact-4' };
    const result = await handleActivate(input, store, enforcer, vkasClient, notifier);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      missingGates: expect.arrayContaining(['clinical', 'compliance']),
    });
    expect(vkasActivateSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact is not in the store', async () => {
    const input: ActivateInput = { artifact_id: 'nonexistent' };
    const result = await handleActivate(input, store, enforcer, vkasClient, notifier);

    expect(result.status).toBe(404);
    expect(vkasActivateSpy).not.toHaveBeenCalled();
  });
});
