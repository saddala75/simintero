import { describe, it, expect, vi } from 'vitest';
import { TerminologyBindingValidator } from '../terminology/TerminologyBindingValidator.js';
import type { TerminologyHttpClient } from '../terminology/TerminologyBindingValidator.js';

const SAMPLE_CQL = `
library KneeArthroscopy version '1.0.0'

valueset "Knee Arthroscopy Procedures": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498'
`;

const KNEE_VS_URL =
  'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498';

describe('TerminologyBindingValidator', () => {
  it('returns { valid: false, unresolvedValueSets: [...] } when mock returns 404', async () => {
    const mockHttpClient: TerminologyHttpClient = {
      get: vi.fn().mockResolvedValue({ status: 404 }),
    };

    const validator = new TerminologyBindingValidator(
      mockHttpClient,
      'http://terminology-gw:3030'
    );

    const result = await validator.validate(SAMPLE_CQL);

    expect(result.valid).toBe(false);
    expect(result.unresolvedValueSets).toContain(KNEE_VS_URL);

    // Verify the correct URL was called
    expect(mockHttpClient.get).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(KNEE_VS_URL))
    );
  });

  it('returns { valid: true, unresolvedValueSets: [] } when mock returns 200', async () => {
    const mockHttpClient: TerminologyHttpClient = {
      get: vi.fn().mockResolvedValue({ status: 200 }),
    };

    const validator = new TerminologyBindingValidator(
      mockHttpClient,
      'http://terminology-gw:3030'
    );

    const result = await validator.validate(SAMPLE_CQL);

    expect(result.valid).toBe(true);
    expect(result.unresolvedValueSets).toHaveLength(0);
  });

  it('returns valid: true when CQL has no valueset declarations', async () => {
    const mockHttpClient: TerminologyHttpClient = {
      get: vi.fn(),
    };

    const validator = new TerminologyBindingValidator(
      mockHttpClient,
      'http://terminology-gw:3030'
    );

    const result = await validator.validate("library Simple version '1.0.0'");

    expect(result.valid).toBe(true);
    expect(result.unresolvedValueSets).toHaveLength(0);
    expect(mockHttpClient.get).not.toHaveBeenCalled();
  });

  it('handles multiple valueset refs — returns unresolved only for 404s', async () => {
    const cql = `
library Multi version '1.0.0'
valueset "Set A": 'http://example.com/vs/a'
valueset "Set B": 'http://example.com/vs/b'
`;

    const mockHttpClient: TerminologyHttpClient = {
      get: vi
        .fn()
        .mockImplementation(async (url: string) => {
          if (url.includes(encodeURIComponent('http://example.com/vs/a'))) {
            return { status: 200 };
          }
          return { status: 404 };
        }),
    };

    const validator = new TerminologyBindingValidator(
      mockHttpClient,
      'http://terminology-gw:3030'
    );

    const result = await validator.validate(cql);

    expect(result.valid).toBe(false);
    expect(result.unresolvedValueSets).toContain('http://example.com/vs/b');
    expect(result.unresolvedValueSets).not.toContain('http://example.com/vs/a');
  });
});
