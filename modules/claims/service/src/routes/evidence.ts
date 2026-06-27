import express from 'express';
import type { Pool } from 'pg';
import { withTenant } from '../db/withTenant.js';

export function buildEvidenceRouter(pool: Pool): express.Router {
  const router = express.Router();

  router.get('/:caseRef/evidence', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
    if (!tenantId) return res.status(401).json({ error: 'Missing x-sim-tenant-id header' });

    const { caseRef } = req.params;

    // Both SELECTs run inside a single withTenant transaction so the RLS GUC is set
    // for the sim_app role before touching claims.claim, ens.case, or revital.analysis.
    const result = await withTenant(pool, tenantId, async (client) => {
      const { rows: claimRows } = await client.query<{
        claim_id: string;
        documentation_status: string;
        rfai_doc_id: string | null;
      }>(
        `SELECT cl.claim_id, cl.documentation_status, cl.rfai_doc_id
         FROM claims.claim cl
         JOIN ens.case c ON c.case_id = cl.case_id AND c.tenant_id = cl.tenant_id
         WHERE c.case_id = $1::uuid AND cl.tenant_id = $2`,
        [caseRef, tenantId],
      );

      if (claimRows.length === 0) {
        return null;
      }

      const claim = claimRows[0]!;

      const { rows: advisoryRows } = await client.query<{
        analysis_id: string;
        advisory_type: string;
        status: string;
        summary: unknown;
        extraction: unknown;
        completeness: unknown;
        triage: unknown;
      }>(
        `SELECT analysis_id, advisory_type, status, summary, extraction, completeness, triage
         FROM revital.analysis
         WHERE case_ref = $1
           AND tenant_id = $2
           AND advisory_type = 'claims_attachment'
         ORDER BY created_at DESC
         LIMIT 1`,
        [caseRef, tenantId],
      );

      return {
        claim_id: claim.claim_id,
        documentation_status: claim.documentation_status,
        rfai_doc_id: claim.rfai_doc_id,
        advisory: advisoryRows[0] ?? null,
      };
    });

    if (result === null) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    return res.status(200).json(result);
  });

  return router;
}
