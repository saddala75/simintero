import { Router } from 'express';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { withTenant } from '../db/withTenant.js';

const VALID_CHANNELS = new Set([
  'fhir_document_reference', 'fhir_binary', 'x12_275', 'portal_upload', 'fax_ocr',
]);

export function createIngestRouter(pool: Pool, store: ObjectStore): Router {
  const router = Router();

  router.post('/documents/ingest', async (req, res) => {
    const { channel, raw_payload, case_ref, created_by } = req.body as {
      channel: string;
      raw_payload: string;
      case_ref?: string;
      created_by: { type: string; id: string };
    };

    if (!VALID_CHANNELS.has(channel)) {
      res.status(400).json({
        type: 'https://errors.simintero.io/SIM-PLAT-DOC-INVALID_CHANNEL',
        code: 'SIM-PLAT-DOC-INVALID_CHANNEL',
        detail: `Channel "${channel}" is not valid`,
      });
      return;
    }

    const tenantId = req.headers['x-sim-tenant-id'] as string;
    const objectKey = `${tenantId}/docs/${crypto.randomUUID()}`;

    // INVARIANT: raw bytes persisted BEFORE any DB write
    const rawBytes = Buffer.isBuffer(raw_payload)
      ? raw_payload
      : Buffer.from(raw_payload, 'base64');
    await store.put(objectKey, rawBytes);

    const docId = await withTenant(pool, tenantId, async (client) => {
      const { rows } = await client.query<{ doc_id: string }>(
        `INSERT INTO docs.document
           (tenant_id, case_ref, doc_type, source_channel, object_key, retention_policy, created_by)
         VALUES
           (current_setting('sim.tenant_id', true), $1, 'unknown', $2, $3, $4, $5)
         RETURNING doc_id`,
        [case_ref ?? null, channel, objectKey, JSON.stringify({ days: 2555 }), JSON.stringify(created_by)],
      );
      return rows[0]?.doc_id;
    });

    res.status(202).json({ doc_id: docId });
  });

  return router;
}
