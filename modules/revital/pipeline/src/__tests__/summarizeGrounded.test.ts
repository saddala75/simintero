import { describe, it, expect, vi } from 'vitest';
import { summarizeGroundedImpl } from '../activities/summarizeGrounded.js';
import type { SpanMap } from '../activities/parseSegment.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

const SPAN_MAP: SpanMap = {
  'd1': [{ page: 1, region: [0, 0, 612, 12], text: 'PT 8 weeks ending April 2026', hash: 'sha256:abc123' }],
};

const INPUT: AnalysisInput = {
  analysis_id: 'ana_1', tenant_id: 'tenant-x', case_ref: 'case_1', document_refs: ['d1'],
  evidence_requirements_ref: null, model_binding_ref: 'ref', model_binding_version: '1.0.0',
  prompt_ref: 'ref', prompt_version: '1.0.0', cell_boundary: 'pooled',
};

describe('summarizeGrounded', () => {
  it('returns assertions with citations when gateway provides cited output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          assertions: [{
            id: 'a1',
            text: 'Member completed PT',
            citations: [{ document_ref: 'd1', page: 1, region: [0, 0, 612, 12], excerpt_hash: 'sha256:abc123' }],
            confidence: 0.91,
          }],
        },
        request_id: 'req_1',
      }),
    }));

    const result = await summarizeGroundedImpl(SPAN_MAP, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('ok');
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]!.citations).toHaveLength(1);
    expect(result.assertions[0]!.citations[0]!.trace_ref).toBe('trc_pending');
  });

  it('drops uncited assertions and returns abstained when none remain', async () => {
    // Returns assertions with empty citations — all should be dropped
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          assertions: [{ id: 'a1', text: 'Uncited claim', citations: [], confidence: 0.8 }],
        },
        request_id: 'req_1',
      }),
    }));

    const result = await summarizeGroundedImpl(SPAN_MAP, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('abstained');
    expect(result.abstain_reason).toBe('all_assertions_uncited');
    expect(result.assertions).toEqual([]);
  });

  it('returns abstained when Model Gateway call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('gateway down')));
    const result = await summarizeGroundedImpl(SPAN_MAP, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('abstained');
    expect(result.abstain_reason).toBe('gateway_error');
  });

  it('retries up to ABSTAIN_IF_CITATION_ATTEMPT_COUNT times before abstaining', async () => {
    // Every call returns uncited assertions → should retry twice then abstain
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: { assertions: [{ id: 'a1', text: 'Uncited', citations: [], confidence: 0.8 }] },
        request_id: 'req_1',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await summarizeGroundedImpl(SPAN_MAP, null, INPUT, 'http://gw', 't_test');
    expect(result.status).toBe('abstained');
    expect(mockFetch).toHaveBeenCalledTimes(2); // ABSTAIN_IF_CITATION_ATTEMPT_COUNT = 2
  });
});
