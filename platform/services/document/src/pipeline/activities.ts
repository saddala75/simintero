import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import type { ObjectStore } from '../store/ObjectStore.js';
import { withTenant } from '../db/withTenant.js';

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
      await withTenant(deps.pool, tenantId, (client) =>
        client.query(
          `UPDATE docs.document SET classification = $1 WHERE doc_id = $2`,
          [
            JSON.stringify({ category: 'clinical_note', sensitivity: 'high', phi_detected: true }),
            docId,
          ],
        ),
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

      const rawBytes = await deps.store.get(objectKey);
      const textKey = `${objectKey}/text`;
      await deps.store.put(textKey, rawBytes);

      await withTenant(deps.pool, tenantId, (client) =>
        client.query(`UPDATE docs.document SET text_key = $1 WHERE doc_id = $2`, [textKey, docId]),
      );
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
