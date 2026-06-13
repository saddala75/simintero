import { describe, it, expect, vi } from 'vitest';
import { extractEntitiesImpl } from '../activities/extractEntities.js';
import type { SpanMap } from '../activities/parseSegment.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

const SPAN_MAP: SpanMap = {
  'd1': [{ page: 1, region: [0, 0, 612, 12], text: 'PT performed ther ex', hash: 'sha256:abc' }],
};

const ANALYSIS_INPUT: AnalysisInput = {
  analysis_id: 'ana_1',
  case_ref: 'case_1',
  document_refs: ['d1'],
  evidence_requirements_ref: null,
  model_binding_ref: 'ref/binding',
  model_binding_version: '1.0.0',
  prompt_ref: 'ref/prompt',
  prompt_version: '1.0.0',
  cell_boundary: 'pooled',
};

describe('extractEntities', () => {
  it('calls Model Gateway with extract_entities task_kind and returns extraction block', async () => {
    const gatewayOutput = {
      entities: [
        { resource_type: 'Procedure', raw_text: 'ther ex', coding_hint: 'CPT:97110', span_ref: 'd1#p1' }
      ]
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: gatewayOutput, request_id: 'req_1' }),
    }));

    const result = await extractEntitiesImpl(SPAN_MAP, ANALYSIS_INPUT, 'http://gw', 't_test');

    expect(result.status).toBe('ok');
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.normalization.code).toBe('97110');
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
