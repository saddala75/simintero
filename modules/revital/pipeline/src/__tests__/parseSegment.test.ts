import { describe, it, expect, vi } from 'vitest';
import { parseSegmentImpl } from '../activities/parseSegment.js';

describe('parseSegment', () => {
  it('builds a SpanMap with page/region/text entries for each document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'PT performed 8 weeks of therapy ending April 12 2026.',
    }));

    const docs = [{
      doc_id: 'd1',
      virus_scan_status: 'clean',
      text_key: 'tenant/docs/d1/text',
      object_key: 'tenant/docs/d1/raw',
    }];

    const spanMap = await parseSegmentImpl(docs, 'http://doc-svc', 'tenant-test');

    expect(spanMap['d1']).toBeDefined();
    expect(spanMap['d1']!.length).toBeGreaterThan(0);
    expect(spanMap['d1']![0]).toMatchObject({ page: 1, text: expect.any(String) });
  });

  it('emits empty entry for documents with no text layer (fetch error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not found')));

    const docs = [{ doc_id: 'd2', virus_scan_status: 'clean', text_key: null, object_key: 'k' }];
    const spanMap = await parseSegmentImpl(docs, 'http://doc-svc', 'tenant-test');

    expect(spanMap['d2']).toEqual([]);
  });

  it('emits empty entry when span endpoint returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 451 }));

    const docs = [{ doc_id: 'd3', virus_scan_status: 'clean', text_key: 'k', object_key: 'k' }];
    const spanMap = await parseSegmentImpl(docs, 'http://doc-svc', 'tenant-test');

    expect(spanMap['d3']).toEqual([]);
  });
});
