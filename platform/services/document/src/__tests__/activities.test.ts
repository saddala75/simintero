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

  it('emitDocumentReady inserts an outbox row with sim.evidence topic', async () => {
    const deps = makeDeps();
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
    await emitDocumentReady(deps, 'd1');
    const insertCall = (deps.pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(insertCall[0]).toContain('shared.outbox');
    const params = insertCall[1] as unknown[];
    expect(params[0]).toContain('sim.evidence');
  });
});
