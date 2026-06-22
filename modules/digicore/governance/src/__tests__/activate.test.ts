import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleActivate } from '../routes/activate.js';
import type { ActivateInput, VkasClient } from '../routes/activate.js';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import { InMemoryGovernanceStore } from '../store/InMemoryGovernanceStore.js';

describe('handleActivate', () => {
  let store: InMemoryGovernanceStore;
  let enforcer: GateEnforcer;
  let vkasClient: VkasClient;
  let vkasActivateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new InMemoryGovernanceStore();
    enforcer = new GateEnforcer();

    vkasActivateSpy = vi.fn().mockResolvedValue(undefined);
    vkasClient = { activate: vkasActivateSpy };
  });

  it('activates BOTH the cql_library and the coverage_rule and emits Activated when both gates are approved', async () => {
    await store.submit({
      artifactId: 'artifact-2',
      createdBy: 'author-1',
      cqlLibraryUrl: 'urn:cql:library-2',
      version: '1.2.0',
    });
    await store.recordApproval({
      artifactId: 'artifact-2',
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });
    await store.recordApproval({
      artifactId: 'artifact-2',
      gate: 'compliance',
      approver: 'officer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });

    const input: ActivateInput = { artifact_id: 'artifact-2' };
    const result = await handleActivate(input, store, enforcer, vkasClient);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ activated: true, artifact_id: 'artifact-2' });

    // Both artifacts activated at the stored version: cql_library FIRST, then coverage_rule
    expect(vkasActivateSpy).toHaveBeenCalledTimes(2);
    expect(vkasActivateSpy).toHaveBeenNthCalledWith(1, 'urn:cql:library-2', '1.2.0');
    expect(vkasActivateSpy).toHaveBeenNthCalledWith(2, 'artifact-2', '1.2.0');

    // An Activated event must have been emitted by the store
    expect(store.events.map(e => e.schemaRef)).toContain('sim.artifact/Activated/v1');
    const activatedEvent = store.events.find(
      e => e.schemaRef === 'sim.artifact/Activated/v1',
    );
    expect(activatedEvent?.payload).toMatchObject({ artifact_id: 'artifact-2' });
  });

  it('activates only the coverage_rule (default version) when no cql_library_url is present', async () => {
    await store.submit({ artifactId: 'artifact-2b', createdBy: 'author-1' });
    await store.recordApproval({
      artifactId: 'artifact-2b',
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });
    await store.recordApproval({
      artifactId: 'artifact-2b',
      gate: 'compliance',
      approver: 'officer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });

    const input: ActivateInput = { artifact_id: 'artifact-2b' };
    const result = await handleActivate(input, store, enforcer, vkasClient);

    expect(result.status).toBe(200);
    expect(vkasActivateSpy).toHaveBeenCalledOnce();
    expect(vkasActivateSpy).toHaveBeenCalledWith('artifact-2b', '1.0.0');
  });

  it('returns 409 with missingGates when only clinical gate is approved', async () => {
    await store.submit({ artifactId: 'artifact-3', createdBy: 'author-1' });
    await store.recordApproval({
      artifactId: 'artifact-3',
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });

    const input: ActivateInput = { artifact_id: 'artifact-3' };
    const result = await handleActivate(input, store, enforcer, vkasClient);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: expect.stringContaining('gates must be approved'),
      missingGates: ['compliance'],
    });
    expect(vkasActivateSpy).not.toHaveBeenCalled();
    expect(store.events.map(e => e.schemaRef)).not.toContain('sim.artifact/Activated/v1');
  });

  it('returns 409 with both missingGates when no gates are approved', async () => {
    await store.submit({ artifactId: 'artifact-4', createdBy: 'author-1' });

    const input: ActivateInput = { artifact_id: 'artifact-4' };
    const result = await handleActivate(input, store, enforcer, vkasClient);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      missingGates: expect.arrayContaining(['clinical', 'compliance']),
    });
    expect(vkasActivateSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact is not in the store', async () => {
    const input: ActivateInput = { artifact_id: 'nonexistent' };
    const result = await handleActivate(input, store, enforcer, vkasClient);

    expect(result.status).toBe(404);
    expect(vkasActivateSpy).not.toHaveBeenCalled();
  });
});
