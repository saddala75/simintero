import { Router } from 'express';
import type { Pool } from 'pg';

export function createMetadataRouter(pool: Pool): Router {
  const router = Router();
  router.get('/documents/:docId/metadata', async (req, res) => {
    const { docId } = req.params;
    const { rows } = await pool.query(
      `SELECT doc_id, case_ref, doc_type, source_channel, ingested_at, virus_scan_status,
              classification, retention_policy, legal_hold
       FROM docs.document WHERE doc_id = $1`,
      [docId],
    );
    if (!rows[0]) { res.status(404).end(); return; }
    res.json(rows[0]);
  });
  return router;
}
