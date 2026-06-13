import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VsacClient } from '../VsacClient.js';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
import { fetch } from 'undici';

const SAMPLE_VSAC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ns0:RetrieveValueSetResponse xmlns:ns0="urn:ihe:iti:svs:2008">
  <ns0:ValueSet ID="2.16.840.1.113762.1.4.1" displayName="Diabetes Conditions" version="20230101">
    <ns0:ConceptList>
      <ns0:Concept code="E11" codeSystem="2.16.840.1.113883.6.90" displayName="Type 2 diabetes mellitus"/>
      <ns0:Concept code="E10" codeSystem="2.16.840.1.113883.6.90" displayName="Type 1 diabetes mellitus"/>
    </ns0:ConceptList>
  </ns0:ValueSet>
</ns0:RetrieveValueSetResponse>`;

describe('VsacClient', () => {
  const cfg = {
    baseUrl: 'https://vsac.nlm.nih.gov/vsac/svs',
    apiKey: 'test-umls-key',
  };
  let client: VsacClient;

  beforeEach(() => {
    client = new VsacClient(cfg);
    vi.resetAllMocks();
  });

  it('expandValueSet returns parsed ValueSet with concepts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_VSAC_XML,
    } as unknown as Response);

    const result = await client.expandValueSet('2.16.840.1.113762.1.4.1');

    expect(result.oid).toBe('2.16.840.1.113762.1.4.1');
    expect(result.version).toBe('20230101');
    expect(result.displayName).toBe('Diabetes Conditions');
    expect(result.concepts).toHaveLength(2);
    expect(result.concepts[0]).toEqual({
      code: 'E11',
      codeSystem: '2.16.840.1.113883.6.90',
      displayName: 'Type 2 diabetes mellitus',
    });
  });

  it('expandValueSet throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as unknown as Response);

    await expect(client.expandValueSet('2.16.840.1.113762.1.4.1')).rejects.toThrow('401');
  });

  it('parses XML fixture correctly with two concepts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_VSAC_XML,
    } as unknown as Response);

    const result = await client.expandValueSet('2.16.840.1.113762.1.4.1');

    expect(result.concepts[1]).toEqual({
      code: 'E10',
      codeSystem: '2.16.840.1.113883.6.90',
      displayName: 'Type 1 diabetes mellitus',
    });
  });
});
