import express from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';

const ADVERSE_OUTCOMES = new Set(['deny', 'partial_deny', 'modify']);
const OPA_GATEWAY_URL = process.env['OPA_GATEWAY_URL'] ?? 'http://localhost:8181';

export function buildDispositionsRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post('/', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    const systemUserId = req.headers['x-sim-user-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });
    if (!systemUserId) return res.status(401).json({ error: 'Missing x-sim-user-id header' });

    const { case_ref, proposed_outcome, confidence, classification, analysis_id } = req.body as {
      case_ref?: string;
      proposed_outcome?: string;
      confidence?: number;
      classification?: string;
      analysis_id?: string;
    };

    if (!case_ref || !proposed_outcome || confidence == null || !classification || !analysis_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Belt-and-suspenders: block adverse outcomes before OPA evaluation
    if (ADVERSE_OUTCOMES.has(proposed_outcome)) {
      const dispositionId = ulid();
      await pool.query(
        `INSERT INTO automation.disposition_log (disposition_id, tenant_id, case_ref, analysis_id, proposed_outcome, allow, deny_reasons, dry_run, system_user_id)
         VALUES ($1, $2, $3, $4, $5, false, $6, true, $7)`,
        [dispositionId, tenantId, case_ref, analysis_id, proposed_outcome, ['adverse_outcome_blocked'], systemUserId],
      );
      return res.status(422).json({ code: 'SIM-AUTO-ADVERSE_BLOCKED', disposition_id: dispositionId, deny_reasons: ['adverse_outcome_blocked'] });
    }

    // Evaluate via OPA gateway
    let opaAllow = false;
    let denyReasons: string[] = [];
    try {
      const entitlementRow = await pool.query<{ value: unknown }>(
        `SELECT value FROM ctrl.entitlement WHERE key = 'ai.automation.live' AND tenant_id = $1`,
        [tenantId],
      );
      const liveEnabled = entitlementRow.rows[0]?.value === true;

      const opaRes = await fetch(`${OPA_GATEWAY_URL}/v1/data/sim/automation/allow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            classification,
            confidence,
            proposed_outcome,
            entitlements: { 'ai.automation.live': liveEnabled },
          },
        }),
      });
      const opaBody = await opaRes.json() as { result?: { allow?: boolean; deny_reasons?: string[] } };
      opaAllow = opaBody.result?.allow === true;
      denyReasons = opaBody.result?.deny_reasons ?? [];
    } catch {
      opaAllow = false;
      denyReasons = ['opa_gateway_error'];
    }

    if (!opaAllow) {
      const dispositionId = ulid();
      await pool.query(
        `INSERT INTO automation.disposition_log (disposition_id, tenant_id, case_ref, analysis_id, proposed_outcome, allow, deny_reasons, dry_run, system_user_id)
         VALUES ($1, $2, $3, $4, $5, false, $6, true, $7)`,
        [dispositionId, tenantId, case_ref, analysis_id, proposed_outcome, denyReasons, systemUserId],
      );
      return res.status(422).json({ code: 'SIM-AUTO-GATE_BLOCKED', disposition_id: dispositionId, deny_reasons: denyReasons });
    }

    // Determine dry_run mode: re-read entitlement (already fetched above — use same liveEnabled)
    const entitlementRow2 = await pool.query<{ value: unknown }>(
      `SELECT value FROM ctrl.entitlement WHERE key = 'ai.automation.live' AND tenant_id = $1`,
      [tenantId],
    );
    const dryRun = entitlementRow2.rows[0]?.value !== true;

    const dispositionId = ulid();

    if (!dryRun) {
      await pool.query(
        `UPDATE ens.case SET state = 'auto_disposed', updated_at = NOW() WHERE case_id = $1::uuid AND tenant_id = $2`,
        [case_ref, tenantId],
      );
    }

    await pool.query(
      `INSERT INTO shared.outbox (tenant_id, topic, payload) VALUES ($1, 'sim.automation.disposition', $2)`,
      [tenantId, JSON.stringify({ event_type: 'DispositionAttempted', case_ref, proposed_outcome, dry_run: dryRun, disposition_id: dispositionId })],
    );

    await pool.query(
      `INSERT INTO automation.disposition_log (disposition_id, tenant_id, case_ref, analysis_id, proposed_outcome, allow, deny_reasons, dry_run, system_user_id)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)`,
      [dispositionId, tenantId, case_ref, analysis_id, proposed_outcome, [], dryRun, systemUserId],
    );

    const status = dryRun ? 'dry_run' : 'executed';
    return res.status(200).json({ disposition_id: dispositionId, status, case_ref });
  });

  return router;
}
