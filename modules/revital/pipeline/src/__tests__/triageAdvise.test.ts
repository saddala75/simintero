import { describe, it, expect, vi } from 'vitest';
import { triageAdviseImpl } from '../activities/triageAdvise.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

const INPUT: AnalysisInput = {
  analysis_id: 'ana_1', tenant_id: 'tenant-x', case_ref: 'case_1', document_refs: [],
  service_code: '27447', model_binding_ref: 'ref', model_binding_version: '1.0.0',
  prompt_ref: 'ref', prompt_version: '1.0.0', cell_boundary: 'pooled',
};

describe('triageAdvise', () => {
  it('returns ok suggestion when confidence >= 0.7 (CONFIDENCE_THRESHOLD)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: { suggestion: 'likely_meets', confidence: 0.84, rationale_assertion_ids: ['a1'] },
        request_id: 'req_1',
      }),
    }));

    const result = await triageAdviseImpl(null, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('ok');
    expect(result.suggestion).toBe('likely_meets');
    expect(result.confidence).toBe(0.84);
    expect(result.calibration_ref).toBeTruthy();
  });

  it('returns abstained when confidence < 0.7 (HUMAN_REVIEW threshold)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: { suggestion: 'needs_rfi', confidence: 0.41, rationale_assertion_ids: [] },
        request_id: 'req_1',
      }),
    }));

    const result = await triageAdviseImpl(null, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('abstained');
    expect(result.suggestion).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  it('returns abstained when gateway call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('gateway down')));
    const result = await triageAdviseImpl(null, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('abstained');
  });

  it('sends requirement_gap_refs and extracted_resource_refs to gateway', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: { suggestion: 'likely_meets', confidence: 0.9, rationale_assertion_ids: [] },
        request_id: 'req_1',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const summary = {
      status: 'ok' as const,
      abstain_reason: null,
      assertions: [{
        id: 'a1', text: 'x', confidence: 0.9,
        citations: [{ document_ref: 'd1', page: 1, region: [0, 0, 1, 1] as [number, number, number, number], excerpt_hash: 'h', trace_ref: 'trc' }],
      }],
    };

    await triageAdviseImpl(summary, null, INPUT, 'http://gw', 't_test');

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.task_kind).toBe('triage_advise');
    expect(body.inputs.extracted_resource_refs).toEqual(['d1']);
  });
});
