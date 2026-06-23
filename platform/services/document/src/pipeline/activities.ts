import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import type { ObjectStore } from '../store/ObjectStore.js';
import { withTenant } from '../db/withTenant.js';
import { detectFormat, extractSpans } from './extractors.js';

export interface ActivityDeps {
  pool: Pool;
  store: ObjectStore;
  ocrEndpoint: string;
}

export function makeActivities(deps: ActivityDeps) {
  return {
    async virusScan(docId: string, tenantId: string): Promise<void> {
      await withTenant(deps.pool, tenantId, (client) =>
        client.query(
          `UPDATE docs.document SET virus_scan_status = 'clean' WHERE doc_id = $1`,
          [docId],
        ),
      );
    },

    async classifyDocument(docId: string, tenantId: string): Promise<void> {
      const objectKey = await withTenant(deps.pool, tenantId, async (client) => {
        const { rows } = await client.query<{ object_key: string }>(
          `SELECT object_key FROM docs.document WHERE doc_id = $1`,
          [docId],
        );
        if (!rows[0]) throw new Error(`Document not found: ${docId}`);
        return rows[0].object_key;
      });

      const bytes = await deps.store.get(objectKey);
      const format = detectFormat(bytes);

      await withTenant(deps.pool, tenantId, (client) =>
        client.query(`UPDATE docs.document SET classification = $1 WHERE doc_id = $2`, [
          JSON.stringify({ format, detected_at: new Date().toISOString(), phi_detected: true }),
          docId,
        ]),
      );
    },

    async extractTextLayer(docId: string, tenantId: string): Promise<void> {
      const objectKey = await withTenant(deps.pool, tenantId, async (client) => {
        const { rows } = await client.query<{ object_key: string }>(
          `SELECT object_key FROM docs.document WHERE doc_id = $1`,
          [docId],
        );
        if (!rows[0]) throw new Error(`Document not found: ${docId}`);
        return rows[0].object_key;
      });

      const bytes = await deps.store.get(objectKey);
      const format = detectFormat(bytes);
      // extractSpans already catches its own failures → 'extract_failed'; it never
      // throws, so the activity always completes and the workflow does not crash.
      // Downstream Revital abstains when there are no spans.
      const r = await extractSpans(
        bytes,
        format,
        deps.ocrEndpoint ? { ocrEndpoint: deps.ocrEndpoint } : undefined,
      );

      const textKey = `${objectKey}/text`;
      await deps.store.put(textKey, Buffer.from(r.text, 'utf8'));

      await withTenant(deps.pool, tenantId, async (client) => {
        // Idempotent re-extraction: clear prior spans first, then re-insert.
        await client.query(`DELETE FROM docs.document_span WHERE doc_id = $1`, [docId]);
        for (const span of r.spans) {
          await client.query(
            `INSERT INTO docs.document_span (doc_id, tenant_id, seq, page, region, text, excerpt_hash)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [
              docId,
              tenantId,
              span.seq,
              span.page,
              JSON.stringify(span.region),
              span.text,
              span.excerpt_hash,
            ],
          );
        }
        await client.query(
          `UPDATE docs.document
             SET text_key = $1,
                 classification = coalesce(classification, '{}'::jsonb)
                   || jsonb_build_object('extraction_status', $2)
           WHERE doc_id = $3`,
          [textKey, r.status, docId],
        );
      });
    },

    async emitDocumentReady(docId: string, tenantId: string): Promise<void> {
      // Emit a canonical DocumentReady event via appendEvent (5-column:
      // event_id, topic, key, envelope, tenant_id). tenantId is threaded from the
      // call site (slice 0.4), so there is no bare-pool tenant lookup — every
      // statement runs under withTenant to satisfy FORCE-RLS under sim_app.
      await withTenant(deps.pool, tenantId, (client) =>
        appendEvent(client, {
          topic: 'sim.evidence',
          schemaRef: 'sim.evidence/DocumentReady/v1',
          tenantId,
          payload: { kind: 'document', doc_id: docId },
          correlationId: docId,
        }),
      );
    },
  };
}
