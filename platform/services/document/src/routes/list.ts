import { Router } from 'express';
import type { Pool } from 'pg';
import { withTenant } from '../db/withTenant.js';

export function createListRouter(pool: Pool): Router {
  const router = Router();

  router.get('/documents', async (req, res) => {
    const caseRef = req.query['case_ref'] as string | undefined;
    if (!caseRef) {
      res.status(400).json({
        type: 'https://errors.simintero.io/SIM-PLAT-DOC-MISSING_CASE_REF',
        code: 'SIM-PLAT-DOC-MISSING_CASE_REF',
        detail: 'Query parameter "case_ref" is required',
      });
      return;
    }

    const tenantId = req.headers['x-sim-tenant-id'] as string;
    const rows = await withTenant(pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT doc_id, case_ref, source_channel, virus_scan_status, ingested_at
         FROM docs.document
         WHERE case_ref = $1
         ORDER BY ingested_at`,
        [caseRef],
      );
      return result.rows;
    });

    res.json(rows);
  });

  return router;
}
