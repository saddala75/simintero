import { describe, it, expect, beforeEach } from 'vitest';
import { handleEnqueue } from '../routes/enqueue.js';
import type { EnqueueInput } from '../routes/enqueue.js';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';

describe('handleEnqueue', () => {
  let store: Map<string, ArtifactApprovalState>;

  beforeEach(() => {
    store = new Map<string, ArtifactApprovalState>();
  });

  it('registers the rule with both urls and version, returns 201', () => {
    const input: EnqueueInput = {
      artifact_id: 'coverage-rule-1',
      cql_library_url: 'urn:cql:library-1',
      version: '1.2.0',
      created_by: 'author-1',
    };

    const result = handleEnqueue(input, store);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ queued: true, artifact_id: 'coverage-rule-1' });

    const state = store.get('coverage-rule-1');
    expect(state).toMatchObject({
      artifact_id: 'coverage-rule-1',
      created_by: 'author-1',
      approvals: [],
      cql_library_url: 'urn:cql:library-1',
      version: '1.2.0',
    });
  });

  it('returns 400 when artifact_id is missing', () => {
    const result = handleEnqueue(
      { artifact_id: '', created_by: 'author-1' } as EnqueueInput,
      store,
    );
    expect(result.status).toBe(400);
    expect(store.size).toBe(0);
  });

  it('returns 400 when created_by is missing', () => {
    const result = handleEnqueue(
      { artifact_id: 'coverage-rule-1', created_by: '' } as EnqueueInput,
      store,
    );
    expect(result.status).toBe(400);
    expect(store.size).toBe(0);
  });

  it('is idempotent — duplicate enqueue does not clobber existing approvals', () => {
    store.set('coverage-rule-1', {
      artifact_id: 'coverage-rule-1',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
      cql_library_url: 'urn:cql:library-1',
      version: '1.2.0',
    });

    const result = handleEnqueue(
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
    expect(store.get('coverage-rule-1')?.approvals).toHaveLength(1);
  });
});
