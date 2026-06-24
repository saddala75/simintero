import { describe, it, expect, vi } from 'vitest';
import { extractEntitiesImpl } from '../activities/extractEntities.js';
import type { SpanMap } from '../activities/parseSegment.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

const SPAN_MAP: SpanMap = {
  'd1': [{ page: 1, region: [0, 0, 612, 12], text: 'PT performed ther ex', hash: 'sha256:abc' }],
};

const ANALYSIS_INPUT: AnalysisInput = {
  analysis_id: 'ana_1',
  tenant_id: 'tenant-x',
  case_ref: 'case_1',
  document_refs: ['d1'],
  service_code: '27447',
  model_binding_ref: 'ref/binding',
  model_binding_version: '1.0.0',
  prompt_ref: 'ref/prompt',
  prompt_version: '1.0.0',
  cell_boundary: 'pooled',
};

/**
 * URL-dispatching fetch mock: routes `/inference` to the gateway response and
 * terminology-service `$find-code`/`$validate-code` to stubbed FHIR responses.
 */
function makeFetchMock(opts: {
  output: unknown;
  request_id: string;
  findCode?: { found: boolean; system?: string; code?: string; display?: string };
  validateCodeResult?: boolean;
}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/inference')) {
      return { ok: true, json: async () => ({ output: opts.output, request_id: opts.request_id }) };
    }
    if (url.includes('$find-code')) {
      return { ok: true, json: async () => opts.findCode ?? { found: false } };
    }
    if (url.includes('$validate-code')) {
      return {
        ok: true,
        json: async () => ({
          resourceType: 'Parameters',
          parameter: [{ name: 'result', valueBoolean: opts.validateCodeResult ?? false }],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('extractEntities', () => {
  it('calls Model Gateway with extract_entities task_kind and returns extraction block', async () => {
    const gatewayOutput = {
      entities: [
        { resource_type: 'Procedure', raw_text: 'ther ex', coding_hint: 'CPT:97110', span_ref: 'd1#p1' }
      ]
    };
    vi.stubGlobal('fetch', makeFetchMock({ output: gatewayOutput, request_id: 'req_1' }));

    const result = await extractEntitiesImpl(SPAN_MAP, ANALYSIS_INPUT, 'http://gw', 't_test');

    expect(result.status).toBe('ok');
    expect(result.resources).toHaveLength(1);
    const norm0 = result.resources[0]!.normalization;
    expect(norm0.coded).toBe(true);
    if (norm0.coded) expect(norm0.code).toBe('97110');
  });

  it('resolves provenance_ref to the gateway request_id, codes entities via $find-code, and omits fabricated confidence', async () => {
    const TERM_PREV = process.env['TERMINOLOGY_URL'];
    process.env['TERMINOLOGY_URL'] = 'http://terminology-service:3030';
    try {
      const gatewayOutput = {
        entities: [
          { resource_type: 'Condition', raw_text: 'osteoarthritis of knee', coding_hint: null, span_ref: 's1' },
        ],
      };
      vi.stubGlobal('fetch', makeFetchMock({
        output: gatewayOutput,
        request_id: 'req_abc',
        findCode: { found: true, system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' },
      }));

      const result = await extractEntitiesImpl(SPAN_MAP, ANALYSIS_INPUT, 'http://gw', 't_test');

      expect(result.status).toBe('ok');
      expect(result.resources).toHaveLength(1);
      const r = result.resources[0]!;
      // request_id resolved into provenance, not the placeholder
      expect(r.provenance_ref).toBe('req_abc');
      expect(r.provenance_ref).not.toBe('trc_pending');
      // terminology-coded via text search
      expect(r.normalization.coded).toBe(true);
      if (r.normalization.coded) {
        expect(r.normalization.system).toBe('http://snomed.info/sct');
        expect(r.normalization.code).toBe('239873007');
      }
      // no fabricated 0.88 confidence (model output carried none)
      expect((r as { confidence?: number }).confidence).toBeUndefined();
    } finally {
      if (TERM_PREV === undefined) delete process.env['TERMINOLOGY_URL'];
      else process.env['TERMINOLOGY_URL'] = TERM_PREV;
    }
  });

  it('returns abstained block when Model Gateway returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await extractEntitiesImpl(SPAN_MAP, ANALYSIS_INPUT, 'http://gw', 't_test');

    expect(result.status).toBe('abstained');
    expect(result.resources).toEqual([]);
  });

  it('sends text_segments (first 20 spans) and document_span_refs to gateway', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: { entities: [] }, request_id: 'req_1' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await extractEntitiesImpl(SPAN_MAP, ANALYSIS_INPUT, 'http://gw', 't_test');

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.task_kind).toBe('extract_entities');
    expect(body.inputs.document_span_refs).toEqual(['d1']);
    expect(body.inputs.text_segments).toEqual(['PT performed ther ex']);
  });
});
