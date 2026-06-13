import { describe, it, expect, vi } from 'vitest';
import { fetchEvidenceRequirementsImpl } from '../activities/fetchEvidenceRequirements.js';

describe('fetchEvidenceRequirements', () => {
  it('returns requirements result from C-1 /evidence-requirements', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requirements: [{ id: 'req-pt-trial', description: '8 weeks PT', evidence_types: ['Procedure'] }],
        trace_ref: 'trc_1',
        pins: [{ canonical_url: 'ref', version: '1.0.0' }],
      }),
    }));

    const result = await fetchEvidenceRequirementsImpl('req_ref_1', 'case_1', 'http://digicore');
    expect(result).not.toBeNull();
    expect(result!.requirements).toHaveLength(1);
    expect(result!.requirements[0]!.id).toBe('req-pt-trial');
    expect(result!.trace_ref).toBe('trc_1');
  });

  it('returns null when Digicore is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect failed')));
    const result = await fetchEvidenceRequirementsImpl('r', 'c', 'http://digicore');
    expect(result).toBeNull();
  });

  it('returns null when Digicore returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await fetchEvidenceRequirementsImpl('r', 'c', 'http://digicore');
    expect(result).toBeNull();
  });
});
