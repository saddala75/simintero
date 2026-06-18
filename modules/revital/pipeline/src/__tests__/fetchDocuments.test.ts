import { describe, it, expect, vi } from 'vitest';
import { fetchDocumentsImpl } from '../activities/fetchDocuments.js';

describe('fetchDocuments', () => {
  it('returns metadata for clean documents', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ doc_id: 'd1', virus_scan_status: 'clean', text_key: 'k1', object_key: 'raw_k1' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const unprocessed: Array<{ ref: string; reason: string }> = [];
    const docs = await fetchDocumentsImpl(['d1'], unprocessed, 'http://doc-svc', 'tenant-test');

    expect(docs).toHaveLength(1);
    expect(docs[0]?.doc_id).toBe('d1');
    expect(unprocessed).toHaveLength(0);
  });

  it('adds quarantined documents to unprocessed_inputs instead of failing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ doc_id: 'd2', virus_scan_status: 'quarantined', text_key: null, object_key: 'raw_k2' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const unprocessed: Array<{ ref: string; reason: string }> = [];
    const docs = await fetchDocumentsImpl(['d2'], unprocessed, 'http://doc-svc', 'tenant-test');

    expect(docs).toHaveLength(0);
    expect(unprocessed[0]).toMatchObject({ ref: 'd2', reason: 'quarantined' });
  });

  it('adds 404 documents to unprocessed_inputs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', mockFetch);

    const unprocessed: Array<{ ref: string; reason: string }> = [];
    await fetchDocumentsImpl(['d3'], unprocessed, 'http://doc-svc', 'tenant-test');

    expect(unprocessed[0]).toMatchObject({ ref: 'd3', reason: 'not_found' });
  });
});
