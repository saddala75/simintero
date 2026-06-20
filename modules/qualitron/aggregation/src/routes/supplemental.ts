import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export function createSupplementalRouter(pool: Pool): Router {
  const router = Router();

  router.post('/v1/quality/supplemental', async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.headers['x-sim-tenant-id'];
    if (!tenantId || typeof tenantId !== 'string') {
      res.status(401).json({ error: 'Missing x-sim-tenant-id header' });
      return;
    }

    const { member_id, doc_content_base64, filename } = req.body as {
      member_id?: string;
      doc_content_base64?: string;
      filename?: string;
    };

    if (!member_id) {
      res.status(400).json({ error: 'Missing required field: member_id' });
      return;
    }

    if (!doc_content_base64) {
      res.status(400).json({ error: 'Missing required field: doc_content_base64' });
      return;
    }

    const docId = ulid();

    await withTenant(pool, tenantId, (client) =>
      appendEvent(client, {
        schemaRef: 'sim.qual.supplemental/SupplementalIngested/v1',
        tenantId,
        topic: 'sim.qual.supplemental',
        correlationId: member_id,
        payload: {
          doc_id: docId,
          member_id,
          filename: filename ?? null,
        },
      }),
    );

    res.status(202).json({ doc_id: docId, status: 'accepted' });
  });

  return router;
}

export default createSupplementalRouter;
