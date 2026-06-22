import { describe, it, expect, beforeEach } from 'vitest';
import { handleEnqueue } from '../routes/enqueue.js';
import type { EnqueueInput } from '../routes/enqueue.js';
import { InMemoryGovernanceStore } from '../store/InMemoryGovernanceStore.js';

describe('handleEnqueue', () => {
  let store: InMemoryGovernanceStore;

  beforeEach(() => {
    store = new InMemoryGovernanceStore();
  });

  it('registers the rule with both urls and version, returns 201', async () => {
    const input: EnqueueInput = {
      artifact_id: 'coverage-rule-1',
      cql_library_url: 'urn:cql:library-1',
      version: '1.2.0',
      created_by: 'author-1',
    };

    const result = await handleEnqueue(input, store);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ queued: true, artifact_id: 'coverage-rule-1' });

    const state = await store.get('coverage-rule-1');
    expect(state).toMatchObject({
      artifact_id: 'coverage-rule-1',
      created_by: 'author-1',
      approvals: [],
      cql_library_url: 'urn:cql:library-1',
      version: '1.2.0',
    });
  });

  it('returns 400 when artifact_id is missing', async () => {
    const result = await handleEnqueue(
      { artifact_id: '', created_by: 'author-1' } as EnqueueInput,
      store,
    );
    expect(result.status).toBe(400);
    expect(await store.list()).toHaveLength(0);
  });

  it('returns 400 when created_by is missing', async () => {
    const result = await handleEnqueue(
      { artifact_id: 'coverage-rule-1', created_by: '' } as EnqueueInput,
      store,
    );
    expect(result.status).toBe(400);
    expect(await store.list()).toHaveLength(0);
  });

  it('is idempotent — duplicate enqueue does not clobber existing approvals', async () => {
    await store.submit({
      artifactId: 'coverage-rule-1',
      createdBy: 'author-1',
      cqlLibraryUrl: 'urn:cql:library-1',
      version: '1.2.0',
    });
    await store.recordApproval({
      artifactId: 'coverage-rule-1',
      gate: 'clinical',
      approver: 'reviewer-1',
      decision: 'approved',
      recordedAt: new Date().toISOString(),
    });

    const result = await handleEnqueue(
      {
        artifact_id: 'coverage-rule-1',
        cql_library_url: 'urn:cql:library-1',
        version: '1.2.0',
        created_by: 'author-1',
      },
      store,
    );

    // Idempotent success (201/200) and the existing entry is preserved
    expect([200, 201]).toContain(result.status);
    expect(result.body).toMatchObject({ queued: true, artifact_id: 'coverage-rule-1' });
    expect((await store.get('coverage-rule-1'))?.approvals).toHaveLength(1);
  });
});
