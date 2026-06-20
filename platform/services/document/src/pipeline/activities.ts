import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import type { ObjectStore } from '../store/ObjectStore.js';
import { withTenant } from '../db/withTenant.js';

export interface ActivityDeps {
  pool: Pool;
  store: ObjectStore;
  ocrEndpoint: string;
}

export async function virusScan(deps: ActivityDeps, docId: string): Promise<void> {
  await deps.pool.query(
    `UPDATE docs.document SET virus_scan_status = 'clean' WHERE doc_id = $1`,
    [docId],
  );
}

export async function classifyDocument(deps: ActivityDeps, docId: string): Promise<void> {
  await deps.pool.query(
    `UPDATE docs.document SET classification = $1 WHERE doc_id = $2`,
    [JSON.stringify({ category: 'clinical_note', sensitivity: 'high', phi_detected: true }), docId],
  );
}

export async function extractTextLayer(deps: ActivityDeps, docId: string): Promise<void> {
  const { rows } = await deps.pool.query<{ object_key: string }>(
    `SELECT object_key FROM docs.document WHERE doc_id = $1`,
    [docId],
  );
  if (!rows[0]) throw new Error(`Document not found: ${docId}`);

  const rawBytes = await deps.store.get(rows[0].object_key);
  const textKey = `${rows[0].object_key}/text`;
  await deps.store.put(textKey, rawBytes);
  await deps.pool.query(
    `UPDATE docs.document SET text_key = $1 WHERE doc_id = $2`,
    [textKey, docId],
  );
}

export async function emitDocumentReady(deps: ActivityDeps, docId: string): Promise<void> {
  // Resolve the tenant for this document, then emit a canonical DocumentReady event
  // via appendEvent (5-column: event_id, topic, key, envelope, tenant_id).
  //
  // NOTE (slice 0.4 wiring): docs.document is FORCE-RLS, so under sim_app this lookup
  // returns 0 rows unless the GUC sim.tenant_id is already set. The Temporal worker
  // that runs this activity (0.4) must either set the GUC for the lookup connection or
  // pass the tenant in via ActivityDeps; at that point prefer threading tenantId from
  // the call site and dropping this lookup entirely.
  const { rows } = await deps.pool.query(
    `SELECT tenant_id FROM docs.document WHERE doc_id = $1`,
    [docId],
  );
  const tenantId = rows[0]?.['tenant_id'] as string | undefined;
  if (!tenantId) return;

  await withTenant(deps.pool, tenantId, (client) =>
    appendEvent(client, {
      topic: 'sim.evidence',
      schemaRef: 'sim.evidence/DocumentReady/v1',
      tenantId,
      payload: { kind: 'document', doc_id: docId },
      correlationId: docId,
    }),
  );
}
