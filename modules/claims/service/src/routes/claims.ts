import express from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { ClearinghouseClient } from '@sim/connector-clearinghouse';

function buildClearinghouseClient(): ClearinghouseClient | null {
  const baseUrl = process.env['CLEARINGHOUSE_URL'];
  const apiKey = process.env['CLEARINGHOUSE_API_KEY'];
  if (!baseUrl || !apiKey) return null;
  return new ClearinghouseClient({
    baseUrl,
    apiKey,
    submitterId: process.env['CLEARINGHOUSE_SUBMITTER_ID'] ?? 'SIMINTERO',
  });
}

export function buildClaimsRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(express.json());

  const chClient = buildClearinghouseClient();

  // POST /v1/claims
  router.post('/', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { claim_number, service_date_start, service_date_end, total_billed_usd, x12_payload } = req.body as Record<string, string>;
    if (!claim_number || !service_date_start || !service_date_end || total_billed_usd == null) {
      return res.status(400).json({ error: 'Missing required fields: claim_number, service_date_start, service_date_end, total_billed_usd' });
    }

    // Insert ens.case with case_type = 'claim'
    const { rows: caseRows } = await pool.query<{ case_id: string }>(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel, case_type)
       VALUES ($1, 'claims', 'intake', 'standard', 'PORTAL', 'claim')
       RETURNING case_id::text AS case_id`,
      [tenantId],
    );
    const caseId = caseRows[0].case_id;

    // Insert claims.claim
    const claimId = ulid();
    await pool.query(
      `INSERT INTO claims.claim (claim_id, tenant_id, case_id, claim_number, service_date_start, service_date_end, total_billed_usd)
       VALUES ($1, $2, $3::uuid, $4, $5::date, $6::date, $7)`,
      [claimId, tenantId, caseId, claim_number, service_date_start, service_date_end, total_billed_usd],
    );

    // Submit to clearinghouse if client is configured and X12 payload provided
    if (chClient && x12_payload) {
      try {
        const ack = await chClient.submitClaim({ claimId, tenantId, x12Payload: x12_payload });
        await pool.query(
          `UPDATE claims.claim SET ack_status = $1, control_number = $2 WHERE claim_id = $3`,
          [ack.status, ack.controlNumber, claimId],
        );
      } catch (err) {
        console.error('[claims] clearinghouse submission failed:', err);
      }
    }

    // Emit lifecycle event to outbox
    await pool.query(
      `INSERT INTO shared.outbox (tenant_id, topic, envelope)
       VALUES ($1, 'sim.claims.lifecycle', $2)`,
      [tenantId, JSON.stringify({ event_type: 'CaseOpened', case_ref: caseId, case_type: 'claim', claim_id: claimId })],
    );

    return res.status(201).json({ case_ref: caseId, claim_id: claimId });
  });

  // GET /v1/claims/:caseRef
  router.get('/:caseRef', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { rows } = await pool.query(
      `SELECT c.case_id::text AS case_ref, c.case_type, c.state, c.created_at,
              cl.claim_id, cl.claim_number, cl.service_date_start, cl.service_date_end,
              cl.total_billed_usd::text AS total_billed_usd, cl.status AS claim_status,
              cl.ack_status, cl.control_number
       FROM ens.case c
       JOIN claims.claim cl ON cl.case_id = c.case_id AND cl.tenant_id = c.tenant_id
       WHERE c.case_id = $1::uuid AND c.tenant_id = $2`,
      [req.params['caseRef'], tenantId],
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Claim case not found' });
    const row = rows[0] as Record<string, unknown>;
    return res.status(200).json({ ...row, total_billed_usd: parseFloat(row['total_billed_usd'] as string) });
  });

  return router;
}
