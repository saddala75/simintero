import express from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export function buildAppealsRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(express.json());

  // POST /v1/appeals
  router.post('/', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { original_case_ref, appeal_type } = req.body as { original_case_ref?: string; appeal_type?: string };
    if (!original_case_ref) return res.status(400).json({ error: 'Missing required field: original_case_ref' });
    if (!appeal_type || !['standard', 'expedited', 'iro'].includes(appeal_type)) {
      return res.status(400).json({ error: "appeal_type must be one of: standard, expedited, iro" });
    }

    // Validate original case belongs to tenant (use 404 — don't reveal existence on cross-tenant)
    const { rows: origRows } = await pool.query<{ case_id: string }>(
      `SELECT case_id::text AS case_id FROM ens.case WHERE case_id = $1::uuid AND tenant_id = $2 LIMIT 1`,
      [original_case_ref, tenantId],
    );
    if (origRows.length === 0) return res.status(404).json({ error: 'Original case not found' });

    // Insert ens.case with case_type = 'appeal'
    const { rows: caseRows } = await pool.query<{ case_id: string }>(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel, case_type)
       VALUES ($1, 'claims', 'intake', 'standard', 'PORTAL', 'appeal')
       RETURNING case_id::text AS case_id`,
      [tenantId],
    );
    const appealCaseId = caseRows[0]!.case_id;

    // Insert claims.appeal
    const appealId = ulid();
    await pool.query(
      `INSERT INTO claims.appeal (appeal_id, tenant_id, appeal_case_id, original_case_id, appeal_type)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5)`,
      [appealId, tenantId, appealCaseId, original_case_ref, appeal_type],
    );

    // Emit lifecycle event
    await withTenant(pool, tenantId, (client) =>
      appendEvent(client, {
        topic: 'sim.claims.lifecycle',
        schemaRef: 'sim.claims.lifecycle/AppealFiled/v1',
        tenantId,
        payload: { event_type: 'AppealOpened', appeal_case_ref: appealCaseId, original_case_ref, appeal_type, appeal_id: appealId },
        correlationId: appealCaseId,
      }),
    );

    return res.status(201).json({ case_ref: appealCaseId, appeal_id: appealId, original_case_ref });
  });

  // GET /v1/appeals/:appealCaseRef
  router.get('/:appealCaseRef', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { rows } = await pool.query(
      `SELECT c.case_id::text AS appeal_case_ref, c.case_type, c.state,
              a.appeal_id, a.appeal_type, a.original_case_id::text AS original_case_ref, a.filed_at
       FROM ens.case c
       JOIN claims.appeal a ON a.appeal_case_id = c.case_id AND a.tenant_id = c.tenant_id
       WHERE c.case_id = $1::uuid AND c.tenant_id = $2`,
      [req.params['appealCaseRef'], tenantId],
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Appeal not found' });
    return res.status(200).json(rows[0]);
  });

  return router;
}
