import express from 'express';
import type { Pool } from 'pg';

const REVITAL_SERVICE_URL = process.env['REVITAL_SERVICE_URL'] ?? 'http://localhost:3050';

export function buildInternalRouter(pool: Pool): express.Router {
  const router = express.Router();

  router.post('/attachment-received', async (req, res) => {
    const { claim_id, case_ref, doc_id, tenant_id, loinc_codes } =
      req.body as Record<string, unknown>;

    if (!claim_id || !case_ref || !doc_id || !tenant_id || !Array.isArray(loinc_codes)) {
      return res.status(400).json({
        error: 'Required: claim_id, case_ref, doc_id, tenant_id, loinc_codes[]',
      });
    }

    const { rows } = await pool.query<{ claim_id: string }>(
      `UPDATE claims.claim
         SET documentation_status = 'received', rfai_doc_id = $1
       WHERE claim_id = $2
         AND tenant_id = $3
       RETURNING claim_id`,
      [doc_id, claim_id, tenant_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Trigger Revital extraction — fire and forget; caller does not wait for completion
    fetch(`${REVITAL_SERVICE_URL}/v1/assist/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sim-tenant-id': tenant_id as string,
      },
      body: JSON.stringify({
        case_ref,
        inputs: {
          document_refs: [doc_id],
          case_context: { loinc_codes },
        },
        analysis_kinds: ['claims_attachment'],
        document_format: 'ccda',
      }),
    }).catch((err: unknown) => {
      console.error('[claims/internal] revital trigger failed', err);
    });

    return res.status(200).json({ ok: true });
  });

  router.post('/attachment-rejected', async (req, res) => {
    const { claim_id, tenant_id, reason } = req.body as Record<string, unknown>;

    if (!claim_id || !tenant_id || !reason) {
      return res.status(400).json({ error: 'Required: claim_id, tenant_id, reason' });
    }

    const { rows } = await pool.query<{ claim_id: string }>(
      `UPDATE claims.claim
         SET documentation_status = 'rejected'
       WHERE claim_id = $1
         AND tenant_id = $2
       RETURNING claim_id`,
      [claim_id, tenant_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    return res.status(200).json({ ok: true });
  });

  return router;
}
