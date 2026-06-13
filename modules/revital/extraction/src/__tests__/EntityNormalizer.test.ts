import { describe, it, expect } from 'vitest';
import { normalizeEntity } from '../EntityNormalizer.js';

describe('EntityNormalizer', () => {
  it('maps a raw "Procedure" entity to a CPT-coded FHIR resource', () => {
    const raw = { resource_type: 'Procedure', raw_text: 'ther ex', coding_hint: 'CPT:97110' };
    const normalized = normalizeEntity(raw);
    expect(normalized.normalization.system).toBe('CPT');
    expect(normalized.normalization.code).toBe('97110');
    expect(normalized.normalization.raw_text).toBe('ther ex');
  });

  it('returns unknown system for entities without a coding hint', () => {
    const raw = { resource_type: 'Observation', raw_text: 'knee pain', coding_hint: null };
    const normalized = normalizeEntity(raw);
    expect(normalized.normalization.system).toBe('unknown');
    expect(normalized.normalization.code).toBe('');
  });
});
