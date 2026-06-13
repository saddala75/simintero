import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';

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
  await deps.pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     SELECT tenant_id, $1, $2
     FROM docs.document WHERE doc_id = $3`,
    ['sim.evidence', JSON.stringify({ kind: 'document', correlation_id: docId }), docId],
  );
}
