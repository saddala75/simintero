import { Router } from 'express';
import type { Pool } from 'pg';

interface RedactionViewRow {
  view_id: string;
  doc_id: string;
  redacted_text: string | null;
  redaction_map: unknown;
  created_at: string;
  created_by: unknown;
}

export function createRedactionViewRouter(pool: Pool): Router {
  const router = Router();

  router.get('/documents/:docId/redactions/:viewId', async (req, res) => {
    const { docId, viewId } = req.params;

    const { rows } = await pool.query<RedactionViewRow>(
      `SELECT view_id, doc_id, redacted_text, redaction_map, created_at, created_by
       FROM docs.redaction_view
       WHERE view_id = $1 AND doc_id = $2`,
      [viewId, docId],
    );

    if (!rows[0]) {
      res.status(404).end();
      return;
    }

    res.json(rows[0]);
  });

  return router;
}
