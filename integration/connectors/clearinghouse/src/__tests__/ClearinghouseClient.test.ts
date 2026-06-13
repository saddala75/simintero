import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClearinghouseClient } from '../ClearinghouseClient.js';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
import { fetch } from 'undici';

describe('ClearinghouseClient', () => {
  const cfg = {
    baseUrl: 'https://ch.example.com',
    apiKey: 'test-key',
    submitterId: 'SIM001',
  };
  let client: ClearinghouseClient;

  beforeEach(() => {
    client = new ClearinghouseClient(cfg);
    vi.resetAllMocks();
  });

  it('submitClaim sends X12 payload and returns AckResult', async () => {
    const mockAck = { controlNumber: 'CTL001', status: 'accepted', errors: [] };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAck,
    } as unknown as Response);

    const result = await client.submitClaim({
      claimId: 'CLM-001',
      tenantId: 't1',
      x12Payload: 'ISA*00*          *00*          *ZZ*SIM001         *ZZ*CH0001         *260101*1200*^*00501*000000001*0*P*:~',
    });

    expect(result.status).toBe('accepted');
    expect(result.controlNumber).toBe('CTL001');
    expect(fetch).toHaveBeenCalledWith(
      'https://ch.example.com/v1/claims/submit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Submitter-ID': 'SIM001' }),
      }),
    );
  });

  it('getRemittance returns null on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as unknown as Response);

    const result = await client.getRemittance('CLM-MISSING');
    expect(result).toBeNull();
  });

  it('submitClaim throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as unknown as Response);

    await expect(
      client.submitClaim({ claimId: 'CLM-001', tenantId: 't1', x12Payload: '' }),
    ).rejects.toThrow('503');
  });

  it('getRemittance returns first remittance on success', async () => {
    const mockRemittance = {
      remittanceId: 'REM-001',
      claimId: 'CLM-001',
      paidAmount: 150.00,
      adjustmentCodes: ['CO-45'],
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remittances: [mockRemittance] }),
    } as unknown as Response);

    const result = await client.getRemittance('CLM-001');
    expect(result).toEqual(mockRemittance);
  });
});
