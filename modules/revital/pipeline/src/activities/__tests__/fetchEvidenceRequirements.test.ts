import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchEvidenceRequirementsImpl } from '../fetchEvidenceRequirements.js';

const resolveBody = {
  service_code: '27447',
  requirements: [
    { requirement_id: 'diagnosis_documented', display: 'Diagnosis documented', required: true,
      evidence_types: ['Condition'], codes: [{ system: 'http://snomed.info/sct', code: '239873007' }],
      negates: [{ system: 'http://snomed.info/sct', code: '30989003' }] },
    { requirement_id: 'imaging_documented', display: 'Imaging documented', required: true, evidence_types: ['Observation'] },
  ],
  pins: ['urn:sim:policy:knee-arthroscopy:1.0.0'],
};

afterEach(() => vi.restoreAllMocks());

describe('fetchEvidenceRequirementsImpl', () => {
  it('POSTs :resolve with service_code and adapts the response to Requirement[]', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('http://digi:3040/v1/runtime/evidence-requirements:resolve');
      expect(JSON.parse(init.body)).toEqual({ service_code: '27447' });
      return { ok: true, json: async () => resolveBody } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchEvidenceRequirementsImpl('27447', 'http://digi:3040');
    expect(out?.requirements[0]).toMatchObject({
      id: 'diagnosis_documented', description: 'Diagnosis documented', required: true,
      evidence_types: ['Condition'],
      codes: [{ system: 'http://snomed.info/sct', code: '239873007' }],
      negates: [{ system: 'http://snomed.info/sct', code: '30989003' }],
    });
    expect(out?.pins).toEqual([{ canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0', version: '' }]);
    expect(out?.trace_ref).toContain('27447');
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as any));
    expect(await fetchEvidenceRequirementsImpl('27447', 'http://digi:3040')).toBeNull();
  });

  it('returns null (degrade-open) on fetch throw / no service_code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await fetchEvidenceRequirementsImpl('27447', 'http://digi:3040')).toBeNull();
  });
});
