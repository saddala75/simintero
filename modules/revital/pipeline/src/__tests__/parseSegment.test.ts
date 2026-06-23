import { describe, it, expect, vi } from 'vitest';
import { parseSegmentImpl } from '../activities/parseSegment.js';

const DOCS = [{ doc_id: 'd1', virus_scan_status: 'clean', text_key: 'k', object_key: 'o' }];

function mockSpans(spans: unknown[]) {
  return vi.fn(async (url: string) => {
    if (String(url).endsWith('/spans')) return { ok: true, json: async () => ({ doc_id: 'd1', spans }) } as any;
    return { ok: false, status: 404 } as any;
  });
}

describe('parseSegment', () => {
  it('maps structured spans (real pages, excerpt_hash->hash) into the SpanMap', async () => {
    vi.stubGlobal('fetch', mockSpans([
      { seq: 0, page: 1, region: [0, 0, 10, 10], text: 'page one text', excerpt_hash: 'sha256:aaa' },
      { seq: 1, page: 2, region: [0, 0, 10, 10], text: 'page two text', excerpt_hash: 'sha256:bbb' },
    ]));

    const sm = await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');

    const d1 = sm['d1']!;
    expect(d1.map(s => s.page)).toEqual([1, 2]); // REAL pages, not all 1
    expect(d1[0]).toEqual({ page: 1, region: [0, 0, 10, 10], text: 'page one text', hash: 'sha256:aaa' });
    expect(d1[1]).toEqual({ page: 2, region: [0, 0, 10, 10], text: 'page two text', hash: 'sha256:bbb' });
  });

  it('hits /spans endpoint (not /span)', async () => {
    const mockFetch = mockSpans([]);
    vi.stubGlobal('fetch', mockFetch);

    await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://doc/documents/d1/spans',
      expect.objectContaining({ headers: { 'x-sim-tenant-id': 'tenant-dev' } }),
    );
  });

  it('empty spans [] -> [] (abstain)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ doc_id: 'd1', spans: [] }) } as any)));
    const sm = await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');
    expect(sm['d1']).toEqual([]);
  });

  it('404 non-ok response -> [] (abstain)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 } as any)));
    const sm = await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');
    expect(sm['d1']).toEqual([]);
  });

  it('451 quarantined non-ok response -> [] (abstain)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 451 } as any)));
    const sm = await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');
    expect(sm['d1']).toEqual([]);
  });

  it('fetch error (network throw) -> [] (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    const sm = await parseSegmentImpl(DOCS as any, 'http://doc', 'tenant-dev');
    expect(sm['d1']).toEqual([]);
  });
});
