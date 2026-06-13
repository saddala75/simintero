import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { IndexClient } from '../IndexClient.js';

export interface QualEvidenceEvent {
  event_id: string;
  tenant_id: string;
  event_type: string;
  gap_id: string;
  measure_ref: string;
  member_id: string;
  gap_type?: string;
}

export async function handleQualEvidenceEvent(
  event: QualEvidenceEvent,
  pool: Pool,
  indexClient: IndexClient,
): Promise<void> {
  // 1. Skip unhandled event types
  if (event.event_type !== 'GapDetected') {
    return;
  }

  // 2. Idempotency check
  const { rows: seen } = await pool.query(
    `SELECT 1 FROM search.index_event WHERE tenant_id = $1 AND entity_type = 'gap' AND entity_id = $2 LIMIT 1`,
    [event.tenant_id, event.gap_id],
  );
  if (seen.length > 0) return;

  // 3. Build IndexDocument
  const content_hash = createHash('sha256')
    .update(event.gap_id)
    .digest('hex');

  const doc = {
    entity_type: 'gap' as const,
    entity_id: event.gap_id,
    tenant_id: event.tenant_id,
    content_hash,
    metadata: {
      measure_ref: event.measure_ref,
      member_id: event.member_id,
      gap_type: event.gap_type ?? 'unknown',
    },
    indexed_at: new Date().toISOString(),
  };

  // 4. Upsert to index
  await indexClient.upsert(doc);

  // 5. Record idempotency
  await pool.query(
    `INSERT INTO search.index_event (event_id, tenant_id, entity_type, entity_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [event.event_id, event.tenant_id, 'gap', event.gap_id],
  );

  // 6. Emit to outbox
  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload) VALUES ($1, 'sim.search.indexed', $2)`,
    [
      event.tenant_id,
      JSON.stringify({
        event_type: 'EntityIndexed',
        entity_type: 'gap',
        entity_id: event.gap_id,
        source_event_id: event.event_id,
      }),
    ],
  );
}
