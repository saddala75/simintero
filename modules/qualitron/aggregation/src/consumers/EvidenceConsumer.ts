import type { Pool } from 'pg';

export interface EvidenceEvent {
  event_id: string;
  event_type: 'DocumentReady' | 'DocumentQuarantined';
  tenant_id: string;
  correlation_id: string;  // case_ref
  doc_id: string;
  occurred_at: string;
}

export async function handleEvidenceEvent(
  event: EvidenceEvent,
  pool: Pool,
): Promise<void> {
  // Idempotency: skip if already processed
  const { rows: seen } = await pool.query(
    `SELECT 1 FROM shared.outbox WHERE payload->>'source_event_id' = $1 LIMIT 1`,
    [event.event_id],
  );
  if (seen.length > 0) return;

  if (event.event_type !== 'DocumentReady') return;

  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     VALUES ($1, $2, $3)`,
    [
      event.tenant_id,
      'sim.qual.evidence',
      JSON.stringify({
        event_type: 'EvidenceIndexed',
        source_event_id: event.event_id,
        doc_id: event.doc_id,
        case_ref: event.correlation_id,
      }),
    ],
  );
}
