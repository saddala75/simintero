import { Router } from 'express';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';

export function createSpanRouter(pool: Pool, store: ObjectStore): Router {
  const router = Router();

  router.get('/documents/:docId/span', async (req, res) => {
    const { docId } = req.params;
    const { rows } = await pool.query<{
      virus_scan_status: string;
      text_key: string | null;
      object_key: string;
    }>(
      `SELECT virus_scan_status, text_key, object_key
       FROM docs.document WHERE doc_id = $1`,
      [docId],
    );
    if (!rows[0]) { res.status(404).end(); return; }

    if (rows[0].virus_scan_status === 'quarantined') {
      res.status(451).json({
        type: 'https://errors.simintero.io/SIM-PLAT-DOC-QUARANTINED',
        code: 'SIM-PLAT-DOC-QUARANTINED',
      });
      return;
    }

    const key = rows[0].text_key ?? rows[0].object_key;
    const bytes = await store.get(key);
    res.status(200).type('application/octet-stream').send(bytes);
  });

  return router;
}
