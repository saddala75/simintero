import { MockAgent, setGlobalDispatcher } from 'undici';
import { describe, it, expect, afterEach } from 'vitest';
import { ClearinghouseClient } from '../ClearinghouseClient.js';

describe('ClearinghouseClient — integration (MockAgent)', () => {
  let mockAgent: MockAgent;

  afterEach(async () => {
    await mockAgent.close();
  });

  it('submits claim and returns accepted ack', async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    const mockPool = mockAgent.get('https://ch.test.com');
    mockPool
      .intercept({ path: '/v1/claims/submit', method: 'POST' })
      .reply(200, {
        controlNumber: 'CTL-TEST-001',
        status: 'accepted',
        errors: [],
      });

    const client = new ClearinghouseClient({
      baseUrl: 'https://ch.test.com',
      apiKey: 'key',
      submitterId: 'SIM001',
    });

    const result = await client.submitClaim({
      claimId: 'CLM-001',
      tenantId: 't1',
      x12Payload: 'ISA*00*          *00*          *ZZ*SIM001         *ZZ*CH0001         *260101*1200*^*00501*000000001*0*P*:~',
    });

    expect(result.controlNumber).toBe('CTL-TEST-001');
    expect(result.status).toBe('accepted');
    expect(result.errors).toHaveLength(0);
  });

  it('getRemittance returns remittance data via mock', async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    const mockPool = mockAgent.get('https://ch.test.com');
    mockPool
      .intercept({ path: '/v1/remittances?claim_id=CLM-001', method: 'GET' })
      .reply(200, {
        remittances: [
          {
            remittanceId: 'REM-TEST-001',
            claimId: 'CLM-001',
            paidAmount: 200.00,
            adjustmentCodes: ['CO-45', 'PR-1'],
          },
        ],
      });

    const client = new ClearinghouseClient({
      baseUrl: 'https://ch.test.com',
      apiKey: 'key',
      submitterId: 'SIM001',
    });

    const remittance = await client.getRemittance('CLM-001');
    expect(remittance).not.toBeNull();
    expect(remittance?.remittanceId).toBe('REM-TEST-001');
    expect(remittance?.paidAmount).toBe(200.00);
  });
});
