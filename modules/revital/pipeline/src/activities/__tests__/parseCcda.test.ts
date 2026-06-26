import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCcdaImpl } from '../parseCcda.js';
import type { DocMeta } from '../fetchDocuments.js';

afterEach(() => vi.restoreAllMocks());

const SAMPLE_CCDA = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="11506-3" displayName="Progress Notes"/>
          <text>Patient presented with knee pain.</text>
          <entry>
            <observation>
              <code displayName="Knee Pain"/>
              <value>#text="Severe bilateral knee pain, onset 3 months ago"</value>
            </observation>
          </entry>
          <entry>
            <observation>
              <code displayName="Vital Signs"/>
              <value>#text="BP 120/80, HR 72"</value>
            </observation>
          </entry>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>`;

function makeFetch(body: string, ok = true) {
  return vi.fn(async (_url: string, _opts: unknown) => ({
    ok,
    text: async () => body,
    status: ok ? 200 : 500,
  }));
}

describe('parseCcdaImpl', () => {
  it('returns spans from C-CDA entry elements', async () => {
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const doc: DocMeta = { doc_id: 'd1', virus_scan_status: 'clean', text_key: null, object_key: 'k1' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d1']).toBeDefined();
    expect(result['d1']!.length).toBeGreaterThan(0);
    result['d1']!.forEach(span => {
      expect(span).toHaveProperty('page', 0);
      expect(span).toHaveProperty('region');
      expect(span.region).toHaveLength(4);
      expect(typeof span.text).toBe('string');
      expect(span.text.length).toBeGreaterThan(0);
      expect(typeof span.hash).toBe('string');
      expect(span.hash).toHaveLength(64); // sha256 hex
    });
  });

  it('sends x-sim-tenant-id header to document service', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { headers: Record<string, string> }) => {
      calls.push({ url, headers: opts?.headers ?? {} });
      return { ok: true, text: async () => SAMPLE_CCDA };
    }));
    const doc: DocMeta = { doc_id: 'doc-x', virus_scan_status: 'clean', text_key: null, object_key: 'k' };
    await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-abc');
    expect(calls[0]?.url).toBe('http://doc:4070/documents/doc-x/span');
    expect(calls[0]?.headers['x-sim-tenant-id']).toBe('tenant-abc');
  });

  it('returns empty spans on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetch('', false));
    const doc: DocMeta = { doc_id: 'd2', virus_scan_status: 'clean', text_key: null, object_key: 'k2' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d2']).toEqual([]);
  });

  it('returns empty spans on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network error'); }));
    const doc: DocMeta = { doc_id: 'd3', virus_scan_status: 'clean', text_key: null, object_key: 'k3' };
    const result = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    expect(result['d3']).toEqual([]);
  });

  it('hash is deterministic for the same text', async () => {
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const doc: DocMeta = { doc_id: 'd4', virus_scan_status: 'clean', text_key: null, object_key: 'k4' };
    const r1 = await parseCcdaImpl([doc], 'http://doc:4070', 'tenant-dev');
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetch(SAMPLE_CCDA));
    const r2 = await parseCcdaImpl([{ ...doc, doc_id: 'd4' }], 'http://doc:4070', 'tenant-dev');
    expect(r1['d4']!.map(s => s.hash)).toEqual(r2['d4']!.map(s => s.hash));
  });
});
