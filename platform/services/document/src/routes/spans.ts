import { Router } from 'express';
import type { Pool } from 'pg';
import { withTenant } from '../db/withTenant.js';

export function createSpansRouter(pool: Pool): Router {
  const router = Router();

  router.get('/documents/:doc_id/spans', async (req, res) => {
    const doc_id = req.params['doc_id'] as string;
    const tenantId = req.headers['x-sim-tenant-id'] as string;

    const result = await withTenant(pool, tenantId, async (client) => {
      // Check doc exists and not quarantined (same pattern as span.ts)
      const { rows: docRows } = await client.query<{ virus_scan_status: string }>(
        `SELECT virus_scan_status FROM docs.document WHERE doc_id = $1`,
        [doc_id],
      );
      const doc = docRows[0];
      if (!doc) return { status: 404 as const };
      if (doc.virus_scan_status === 'quarantined') return { status: 451 as const };

      // Fetch structured spans ordered by seq
      const { rows: spanRows } = await client.query<{
        seq: number;
        page: number;
        region: [number, number, number, number];
        text: string;
        excerpt_hash: string;
      }>(
        `SELECT seq, page, region, text, excerpt_hash
         FROM docs.document_span
         WHERE doc_id = $1
         ORDER BY seq`,
        [doc_id],
      );
      return { status: 200 as const, spans: spanRows };
    });

    if (result.status === 404) { res.status(404).end(); return; }

    if (result.status === 451) {
      res.status(451).json({
        type: 'https://errors.simintero.io/SIM-PLAT-DOC-QUARANTINED',
        code: 'SIM-PLAT-DOC-QUARANTINED',
      });
      return;
    }

    res.status(200).json({ doc_id, spans: result.spans });
  });

  return router;
}
