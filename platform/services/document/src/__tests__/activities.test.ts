import { describe, it, expect, vi } from 'vitest';
import { makeActivities } from '../pipeline/activities.js';
import type { ActivityDeps } from '../pipeline/activities.js';

/**
 * Build a fake `deps` whose `pool.connect()` returns a single recording client
 * (shared across all connect() calls so the activity's statements are inspectable
 * in order). The client records every `query(text, params)` so we can assert that
 * withTenant issued BEGIN → set_config('sim.tenant_id', tenantId) → the statement
 * → COMMIT, and has a `release()`.
 */
function makeFakeDeps(opts?: { selectRows?: unknown[] }) {
  const clientQuery = vi
    .fn()
    .mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT object_key')) {
        return Promise.resolve({ rows: opts?.selectRows ?? [{ object_key: 'tenant/docs/d1/raw' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  const release = vi.fn();
  const client = { query: clientQuery, release };
  const connect = vi.fn().mockResolvedValue(client);

  const store = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(Buffer.from('raw content')),
    delete: vi.fn(),
  };

  const deps = {
    pool: { connect } as unknown as import('pg').Pool,
    store,
    ocrEndpoint: 'http://ocr-mock',
  } satisfies ActivityDeps;

  return { deps, clientQuery, release, connect, store };
}

function clientSql(clientQuery: ReturnType<typeof vi.fn>): string[] {
  return clientQuery.mock.calls.map((c) => c[0] as string);
}

describe('Document pipeline activities (factory)', () => {
  it('virusScan marks the document clean under withTenant', async () => {
    const { deps, clientQuery } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.virusScan('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);
    const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
    const updateIdx = sqls.findIndex((s) => s.includes("virus_scan_status = 'clean'"));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(gucIdx);
    // set_config carries the tenant id before the UPDATE runs.
    expect((clientQuery.mock.calls[gucIdx] as unknown[])[1]).toEqual(['tenant-dev']);
    // UPDATE ran on the withTenant client.
    expect((clientQuery.mock.calls[updateIdx] as unknown[])[1]).toEqual(['doc-1']);
  });

  it('classifyDocument writes classification JSONB under withTenant', async () => {
    const { deps, clientQuery } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.classifyDocument('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);
    const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
    const updateIdx = sqls.findIndex((s) => s.includes('classification'));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(gucIdx);
    expect((clientQuery.mock.calls[gucIdx] as unknown[])[1]).toEqual(['tenant-dev']);
  });

  it('extractTextLayer: SELECT (withTenant) → store.get → store.put → UPDATE text_key (withTenant)', async () => {
    const { deps, clientQuery, store } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.extractTextLayer('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);

    // SELECT object_key ran under a set_config.
    const selectIdx = sqls.findIndex((s) => s.includes('SELECT object_key'));
    const firstGucIdx = sqls.findIndex((s) => s.includes('set_config'));
    expect(firstGucIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(firstGucIdx);

    // object store round-trip.
    expect(store.get).toHaveBeenCalledWith('tenant/docs/d1/raw');
    expect(store.put).toHaveBeenCalledWith('tenant/docs/d1/raw/text', Buffer.from('raw content'));

    // UPDATE text_key ran under a set_config too.
    const updateIdx = sqls.findIndex((s) => s.includes('text_key'));
    expect(updateIdx).toBeGreaterThan(selectIdx);
    const gucBeforeUpdate = sqls
      .slice(0, updateIdx)
      .reduce((acc, s, i) => (s.includes('set_config') ? i : acc), -1);
    expect(gucBeforeUpdate).toBeGreaterThanOrEqual(0);
    expect((clientQuery.mock.calls[updateIdx] as unknown[])[1]).toEqual([
      'tenant/docs/d1/raw/text',
      'doc-1',
    ]);
  });

  it('extractTextLayer throws when the document is not found', async () => {
    const { deps } = makeFakeDeps({ selectRows: [] });
    const acts = makeActivities(deps);
    await expect(acts.extractTextLayer('missing', 'tenant-dev')).rejects.toThrow(
      'Document not found: missing',
    );
  });

  it('emitDocumentReady writes the canonical 5-column envelope inside withTenant — no bare lookup, no payload column', async () => {
    const { deps, clientQuery, release } = makeFakeDeps();
    const acts = makeActivities(deps);
    await acts.emitDocumentReady('doc-1', 'tenant-dev');

    const sqls = clientSql(clientQuery);

    // The bare `SELECT tenant_id` lookup is gone.
    expect(sqls.some((s) => s.includes('SELECT tenant_id'))).toBe(false);

    // GUC (set_config) is set before any INSERT.
    const gucIdx = sqls.findIndex((s) => s.includes('set_config'));
    const insertIdx = sqls.findIndex((s) => s.includes('INSERT INTO shared.outbox'));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(gucIdx);
    // set_config carries the tenant id threaded as the activity arg.
    expect((clientQuery.mock.calls[gucIdx] as unknown[])[1]).toEqual(['tenant-dev']);

    const insertCall = clientQuery.mock.calls[insertIdx] as unknown[];
    const insertSql = insertCall[0] as string;
    // canonical 5-column shape, no phantom payload column.
    expect(insertSql).toContain('(event_id, topic, key, envelope, tenant_id)');
    expect(insertSql).not.toMatch(/\bpayload\b/);

    const params = insertCall[1] as unknown[];
    expect(params[1]).toBe('sim.evidence'); // topic
    expect(params[4]).toBe('tenant-dev'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.evidence/DocumentReady/v1');
    expect(envelope['payload']).toEqual({ kind: 'document', doc_id: 'doc-1' });
    expect(release).toHaveBeenCalled();
  });
});
