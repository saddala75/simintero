import { describe, it, expect, vi } from 'vitest';
import { virusScan, classifyDocument, extractTextLayer, emitDocumentReady } from '../pipeline/activities.js';
import type { ActivityDeps } from '../pipeline/activities.js';

function makeDeps(): ActivityDeps {
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [{ object_key: 'tenant/docs/d1/raw' }] }),
    } as unknown as import('pg').Pool,
    store: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(Buffer.from('raw content')),
      delete: vi.fn(),
    },
    ocrEndpoint: 'http://ocr-mock',
  };
}

describe('Document pipeline activities', () => {
  it('virusScan marks the document clean', async () => {
    const deps = makeDeps();
    await virusScan(deps, 'd1');
    const firstCall = (deps.pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(firstCall[0]).toContain("virus_scan_status = 'clean'");
  });

  it('classifyDocument writes classification JSONB', async () => {
    const deps = makeDeps();
    await classifyDocument(deps, 'd1');
    const firstCall = (deps.pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const sql = firstCall[0] as string;
    expect(sql).toContain('classification');
  });

  it('extractTextLayer fetches raw bytes, writes text layer, updates text_key', async () => {
    const deps = makeDeps();
    await extractTextLayer(deps, 'd1');
    expect(deps.store.get).toHaveBeenCalledWith('tenant/docs/d1/raw');
    expect(deps.store.put).toHaveBeenCalled();
    const updateCall = (deps.pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('text_key'));
    expect(updateCall).toBeTruthy();
  });

  it('emitDocumentReady writes the canonical 5-column envelope inside withTenant', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const poolQuery = vi
      .fn()
      // tenant lookup
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1' }] });
    const deps = {
      pool: {
        query: poolQuery,
        connect: vi.fn().mockResolvedValue({ query: clientQuery, release }),
      } as unknown as import('pg').Pool,
      store: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      ocrEndpoint: 'http://ocr-mock',
    } satisfies ActivityDeps;

    await emitDocumentReady(deps, 'd1');

    // tenant lookup ran on the bare pool
    expect((poolQuery.mock.calls[0] as unknown[])[0]).toContain('SELECT tenant_id FROM docs.document');

    const clientCalls = clientQuery.mock.calls.map((c) => c[0] as string);
    // GUC is set (set_config) before any INSERT
    const gucIdx = clientCalls.findIndex((sql) => sql.includes('set_config'));
    const insertIdx = clientCalls.findIndex((sql) => sql.includes('INSERT INTO shared.outbox'));
    expect(gucIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(gucIdx);

    const insertCall = clientQuery.mock.calls[insertIdx] as unknown[];
    const insertSql = insertCall[0] as string;
    // canonical 5-column shape, no phantom payload column
    expect(insertSql).toContain('(event_id, topic, key, envelope, tenant_id)');
    expect(insertSql).not.toMatch(/\bpayload\b/);

    const params = insertCall[1] as unknown[];
    expect(params[1]).toBe('sim.evidence'); // topic
    expect(params[4]).toBe('t1'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.evidence/DocumentReady/v1');
    expect(envelope['payload']).toEqual({ kind: 'document', doc_id: 'd1' });
    expect(release).toHaveBeenCalled();
  });

  it('emitDocumentReady is a no-op when the document/tenant is not found', async () => {
    const connect = vi.fn();
    const deps = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        connect,
      } as unknown as import('pg').Pool,
      store: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      ocrEndpoint: 'http://ocr-mock',
    } satisfies ActivityDeps;

    await emitDocumentReady(deps, 'missing');
    // never opened a tenant-scoped connection -> no outbox write
    expect(connect).not.toHaveBeenCalled();
  });
});
