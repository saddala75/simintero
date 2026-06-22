import { describe, it, expect, vi } from 'vitest';
import { rollbackArtifact } from '../rollback.js';

const URL = 'policy://pa-criteria/v1';

/**
 * Builds a mocked pg client whose `query` dispatches on the SQL text.
 * @param opts.target  the row returned for the target SELECT (null → not found)
 * @param opts.prior   the row returned for the superseded-prior SELECT (null → no prior)
 */
function mockClient(opts: {
  target: Record<string, unknown> | null;
  prior: Record<string, unknown> | null;
}) {
  const calls: string[] = [];
  // After the target+prior lookups, the two SELECT-by-version reads (rolled_back
  // then restored) need to return the post-update shape. We track which row each
  // version maps to via a tiny store keyed by version.
  const store: Record<string, Record<string, unknown>> = {};
  if (opts.target) store[opts.target['version'] as string] = { ...opts.target };
  if (opts.prior) store[opts.prior['version'] as string] = { ...opts.prior };

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push(sql);
    // outbox insert
    if (/INSERT INTO shared\.outbox/i.test(sql)) {
      return { rows: [] };
    }
    // UPDATE target -> rolled_back
    if (/UPDATE vkas\.artifact SET status='rolled_back'/i.test(sql)) {
      const v = params?.[1] as string;
      if (store[v]) store[v]['status'] = 'rolled_back';
      return { rows: [], rowCount: 1 };
    }
    // UPDATE prior -> active
    if (/UPDATE vkas\.artifact SET status='active'/i.test(sql)) {
      const v = params?.[1] as string;
      if (store[v]) store[v]['status'] = 'active';
      return { rows: [], rowCount: 1 };
    }
    // SELECT the most-recent superseded prior
    if (/status='superseded'/i.test(sql)) {
      return opts.prior ? { rows: [opts.prior], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // SELECT a specific version (target lookup, and the final re-reads)
    if (/WHERE canonical_url=\$1 AND version=\$2/i.test(sql)) {
      const v = params?.[1] as string;
      // The very first such SELECT is the target lookup.
      if (store[v]) return { rows: [store[v]], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as any, calls, query };
}

const ARGS = {
  canonicalUrl: URL,
  version: '2.0.0',
  reason: 'bad rule',
  incidentRef: 'INC-42',
  tenantId: 'tenant-dev',
};

describe('rollbackArtifact', () => {
  it('happy path: demotes target, restores prior, emits two outbox events', async () => {
    const { client, calls } = mockClient({
      target: { canonical_url: URL, version: '2.0.0', status: 'active', artifact_type: 'coverage_criteria' },
      prior: { canonical_url: URL, version: '1.0.0', status: 'superseded', artifact_type: 'coverage_criteria' },
    });

    const result = await rollbackArtifact(client, ARGS);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.rolledBack.version).toBe('2.0.0');
    expect(result.rolledBack.status).toBe('rolled_back');
    expect(result.restored.version).toBe('1.0.0');
    expect(result.restored.status).toBe('active');

    // target -> rolled_back
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='rolled_back'/i.test(s))).toBe(true);
    // prior -> active
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
    // TWO outbox INSERTs (ArtifactRolledBack then ArtifactActivated)
    const outboxInserts = calls.filter((s) => /INSERT INTO shared\.outbox/i.test(s));
    expect(outboxInserts.length).toBe(2);
  });

  it('not_found: target SELECT empty → no updates', async () => {
    const { client, calls } = mockClient({ target: null, prior: null });
    const result = await rollbackArtifact(client, ARGS);
    expect(result.status).toBe('not_found');
    expect(calls.some((s) => /UPDATE vkas\.artifact/i.test(s))).toBe(false);
    expect(calls.some((s) => /INSERT INTO shared\.outbox/i.test(s))).toBe(false);
  });

  it('not_active: target not in active status → no updates', async () => {
    const { client, calls } = mockClient({
      target: { canonical_url: URL, version: '2.0.0', status: 'draft', artifact_type: 'coverage_criteria' },
      prior: { canonical_url: URL, version: '1.0.0', status: 'superseded', artifact_type: 'coverage_criteria' },
    });
    const result = await rollbackArtifact(client, ARGS);
    expect(result.status).toBe('not_active');
    expect(calls.some((s) => /UPDATE vkas\.artifact/i.test(s))).toBe(false);
    expect(calls.some((s) => /INSERT INTO shared\.outbox/i.test(s))).toBe(false);
  });

  it('no_prior: no superseded prior → no updates', async () => {
    const { client, calls } = mockClient({
      target: { canonical_url: URL, version: '2.0.0', status: 'active', artifact_type: 'coverage_criteria' },
      prior: null,
    });
    const result = await rollbackArtifact(client, ARGS);
    expect(result.status).toBe('no_prior');
    expect(calls.some((s) => /UPDATE vkas\.artifact/i.test(s))).toBe(false);
    expect(calls.some((s) => /INSERT INTO shared\.outbox/i.test(s))).toBe(false);
  });
});
