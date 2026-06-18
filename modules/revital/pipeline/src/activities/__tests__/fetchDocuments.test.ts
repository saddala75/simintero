import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchDocumentsImpl } from '../fetchDocuments.js';

afterEach(() => vi.restoreAllMocks());

describe('fetchDocumentsImpl tenant header', () => {
  it('sends x-sim-tenant-id from the passed tenantId', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { headers: Record<string, string> }) => {
      calls.push({ url, headers: opts?.headers ?? {} });
      return { ok: true, json: async () => ({ doc_id: 'd1', virus_scan_status: 'clean', text_key: null, object_key: 'o' }) };
    }));
    const unprocessed: Array<{ ref: string; reason: string }> = [];
    await fetchDocumentsImpl(['d1'], unprocessed, 'http://doc:3010', 'tenant-dev');
    expect(calls[0]?.headers['x-sim-tenant-id']).toBe('tenant-dev');
  });
});
