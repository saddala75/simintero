import { fetch } from 'undici';
import type { ClearinghouseConfig, ClaimSubmission, AckResult, RemittanceNotice } from './types.js';

export class ClearinghouseClient {
  constructor(private cfg: ClearinghouseConfig) {}

  async submitClaim(claim: ClaimSubmission): Promise<AckResult> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/claims/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'X-Submitter-ID': this.cfg.submitterId,
      },
      body: JSON.stringify({
        claim_id: claim.claimId,
        submitter_id: this.cfg.submitterId,
        payload: claim.x12Payload,
      }),
    });
    if (!res.ok) throw new Error(`Clearinghouse submit failed: ${res.status}`);
    return res.json() as Promise<AckResult>;
  }

  async getRemittance(claimId: string): Promise<RemittanceNotice | null> {
    const res = await fetch(
      `${this.cfg.baseUrl}/v1/remittances?claim_id=${encodeURIComponent(claimId)}`,
      { headers: { 'Authorization': `Bearer ${this.cfg.apiKey}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Clearinghouse remittance fetch failed: ${res.status}`);
    const body = await res.json() as { remittances: RemittanceNotice[] };
    return body.remittances[0] ?? null;
  }

  async pollAck(controlNumber: string, maxWaitMs = 30_000): Promise<AckResult> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await fetch(
        `${this.cfg.baseUrl}/v1/acks/${encodeURIComponent(controlNumber)}`,
        { headers: { 'Authorization': `Bearer ${this.cfg.apiKey}` } },
      );
      if (res.ok) {
        const ack = await res.json() as AckResult;
        if (ack.status !== 'pending') return ack;
      }
      await new Promise(r => setTimeout(r, 2_000));
    }
    throw new Error(`Timeout waiting for ACK on control number ${controlNumber}`);
  }
}
