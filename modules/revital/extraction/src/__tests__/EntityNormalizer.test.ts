import { describe, it, expect } from 'vitest';
import { normalizeEntity } from '../EntityNormalizer.js';
import type { TerminologyLookup } from '../EntityNormalizer.js';

// --- helpers ------------------------------------------------------------------

function makeLookup(
  validateResult: boolean | { valid: boolean; display?: string } | Error,
  findResult: { system: string; code: string; display: string } | null | Error,
): TerminologyLookup {
  return {
    validateCode: async (_system: string, _code: string) => {
      if (validateResult instanceof Error) throw validateResult;
      return validateResult;
    },
    findCode: async (_text: string) => {
      if (findResult instanceof Error) throw findResult;
      return findResult;
    },
  };
}

// --- cases --------------------------------------------------------------------

describe('normalizeEntity (async + injected lookup)', () => {
  it('validates a model coding_hint and returns a coded result with source model-hint', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'osteoarthritis of knee',
      coding_hint: 'http://snomed.info/sct:239873007',
    };
    const lookup = makeLookup(true, null);
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(true);
    if (!result.coded) throw new Error('expected coded result');
    expect(result.validated).toBe(true);
    expect(result.source).toBe('model-hint');
    expect(result.system).toBe('http://snomed.info/sct');
    expect(result.code).toBe('239873007');
    // raw_text preserved so caller (extractEntities) can still access it
    expect(result.raw_text).toBe('osteoarthritis of knee');
  });

  it('uses validateCode display when returned as an object', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'osteoarthritis of knee',
      coding_hint: 'http://snomed.info/sct:239873007',
    };
    const lookup = makeLookup({ valid: true, display: 'Osteoarthritis of knee' }, null);
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(true);
    if (!result.coded) throw new Error('expected coded result');
    expect(result.validated).toBe(true);
    expect(result.source).toBe('model-hint');
    expect(result.display).toBe('Osteoarthritis of knee');
  });

  it('falls back to text-search when coding_hint is null and findCode returns a match', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'osteoarthritis of knee',
      coding_hint: null,
    };
    const lookup = makeLookup(false, {
      system: 'http://snomed.info/sct',
      code: '239873007',
      display: 'Osteoarthritis of knee',
    });
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(true);
    if (!result.coded) throw new Error('expected coded result');
    expect(result.source).toBe('text-search');
    expect(result.system).toBe('http://snomed.info/sct');
    expect(result.code).toBe('239873007');
    expect(result.display).toBe('Osteoarthritis of knee');
    expect(result.raw_text).toBe('osteoarthritis of knee');
  });

  it('returns clean uncoded result when both coding_hint is null and findCode returns null — no fabricated codes', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'some unknown text',
      coding_hint: null,
    };
    const lookup = makeLookup(false, null);
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(false);
    expect(result.source).toBe('uncoded');
    // Crucially: no fabricated system or empty code — narrow to check the raw object
    const raw = result as unknown as Record<string, unknown>;
    expect(raw['system']).toBeUndefined();
    expect(raw['code']).toBeUndefined();
    // raw_text still preserved
    expect(result.raw_text).toBe('some unknown text');
  });

  it('returns uncoded when validateCode throws — does not re-throw', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'knee pain',
      coding_hint: 'http://snomed.info/sct:30989003',
    };
    const lookup = makeLookup(new Error('network failure'), null);
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(false);
    expect(result.source).toBe('uncoded');
  });

  it('returns uncoded when findCode throws — does not re-throw', async () => {
    const entity = {
      resource_type: 'Condition',
      raw_text: 'knee pain',
      coding_hint: null,
    };
    const lookup = makeLookup(false, new Error('service unavailable'));
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(false);
    expect(result.source).toBe('uncoded');
  });

  it('handles a CPT-coded hint (legacy style with short system name)', async () => {
    const entity = {
      resource_type: 'Procedure',
      raw_text: 'ther ex',
      coding_hint: 'CPT:97110',
    };
    const lookup = makeLookup(true, null);
    const result = await normalizeEntity(entity, lookup);

    expect(result.coded).toBe(true);
    if (!result.coded) throw new Error('expected coded result');
    expect(result.system).toBe('CPT');
    expect(result.code).toBe('97110');
    expect(result.raw_text).toBe('ther ex');
    expect(result.source).toBe('model-hint');
  });

  it('exposes system/code/raw_text at the top level matching what extractEntities will read', async () => {
    // extractEntities currently reads `.normalization.{system,code,raw_text}` (Task 3 will update it
    // to read the NormalizedResult directly).  Verify the fields are on the result.
    const entity = {
      resource_type: 'Condition',
      raw_text: 'osteoarthritis of knee',
      coding_hint: 'http://snomed.info/sct:239873007',
    };
    const lookup = makeLookup(true, null);
    const result = await normalizeEntity(entity, lookup);

    if (!result.coded) throw new Error('expected coded result');
    expect(result.system).toBe('http://snomed.info/sct');
    expect(result.code).toBe('239873007');
    expect(result.raw_text).toBe('osteoarthritis of knee');
  });
});
