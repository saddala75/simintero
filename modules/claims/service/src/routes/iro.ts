import express from 'express';
import type { Pool } from 'pg';

export function buildIRORouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(express.json());

  // POST /v1/iro/decision — receives IRO decision webhook
  router.post('/decision', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { iro_vendor_id, appeal_case_ref, decision } = req.body as {
      iro_vendor_id?: string;
      appeal_case_ref?: string;
      decision?: string;
    };

    if (!iro_vendor_id) return res.status(400).json({ error: 'Missing required field: iro_vendor_id' });
    if (!appeal_case_ref) return res.status(400).json({ error: 'Missing required field: appeal_case_ref' });
    if (!decision || !['overturn', 'uphold'].includes(decision)) {
      return res.status(400).json({ error: "decision must be one of: overturn, uphold" });
    }

    // Update ens.case state based on IRO decision
    const newState = decision === 'overturn' ? 'OVERTURNED' : 'UPHELD';
    await pool.query(
      `UPDATE ens.case SET state = $1, updated_at = NOW()
       WHERE case_id = $2::uuid AND tenant_id = $3`,
      [newState, appeal_case_ref, tenantId],
    );

    // Emit lifecycle event
    await pool.query(
      `INSERT INTO shared.outbox (tenant_id, topic, payload)
       VALUES ($1, 'sim.claims.lifecycle', $2)`,
      [tenantId, JSON.stringify({
        event_type: 'IRODecisionReceived',
        appeal_case_ref,
        decision,
        iro_vendor_id,
      })],
    );

    return res.status(200).json({ appeal_case_ref, decision, new_state: newState });
  });

  return router;
}
