import { Router } from 'express';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { PresidioClient } from '../redaction/PresidioClient.js';

export function createRedactRouter(pool: Pool, store: ObjectStore): Router {
  const router = Router();

  const presidio = new PresidioClient(
    process.env['PRESIDIO_ANALYZER_URL'] ?? 'http://presidio-analyzer:5001',
    process.env['PRESIDIO_ANONYMIZER_URL'] ?? 'http://presidio-anonymizer:5002',
  );

  router.post('/documents/:docId/redact', async (req, res) => {
    const tenantId = req.headers['x-sim-tenant-id'];
    const userId = req.headers['x-sim-user-id'];

    if (!tenantId || typeof tenantId !== 'string') {
      res.status(401).end();
      return;
    }
    if (!userId || typeof userId !== 'string') {
      res.status(401).end();
      return;
    }

    const { docId } = req.params;

    const { rows } = await pool.query<{
      virus_scan_status: string;
      text_key: string | null;
      object_key: string;
    }>(
      `SELECT virus_scan_status, text_key, object_key
       FROM docs.document
       WHERE doc_id = $1 AND tenant_id = $2`,
      [docId, tenantId],
    );

    if (!rows[0]) {
      res.status(404).end();
      return;
    }

    if (rows[0].virus_scan_status === 'quarantined') {
      res.status(451).json({
        type: 'https://errors.simintero.io/SIM-PLAT-DOC-QUARANTINED',
        code: 'SIM-PLAT-DOC-QUARANTINED',
        detail: 'Document is quarantined and cannot be redacted.',
      });
      return;
    }

    const key = rows[0].text_key ?? rows[0].object_key;
    const bytes = await store.get(key);
    const text = Buffer.from(bytes).toString('utf-8');

    const entities = await presidio.analyze(text);
    const { text: redactedText, items } = await presidio.anonymize(text, entities);

    const redactionMap: Record<string, Array<{ start: number; end: number }>> = {};
    for (const item of items) {
      const bucket = redactionMap[item.entity_type] ?? [];
      bucket.push({ start: item.start, end: item.end });
      redactionMap[item.entity_type] = bucket;
    }

    const { rows: inserted } = await pool.query<{ view_id: string }>(
      `INSERT INTO docs.redaction_view (doc_id, tenant_id, redaction_map, redacted_text, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
       RETURNING view_id`,
      [docId, tenantId, JSON.stringify(redactionMap), redactedText, JSON.stringify({ user_id: userId })],
    );

    const viewId = inserted[0]?.view_id;
    if (!viewId) throw new Error('INSERT INTO docs.redaction_view returned no view_id');

    res.status(201).json({
      view_id: viewId,
      doc_id: docId,
      entity_count: items.length,
    });
  });

  return router;
}
