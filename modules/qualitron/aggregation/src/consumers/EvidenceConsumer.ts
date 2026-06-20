import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

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

  await withTenant(pool, event.tenant_id, (client) =>
    appendEvent(client, {
      schemaRef: 'sim.qual.evidence/EvidenceIndexed/v1',
      tenantId: event.tenant_id,
      topic: 'sim.qual.evidence',
      correlationId: event.correlation_id,
      payload: {
        event_type: 'EvidenceIndexed',
        source_event_id: event.event_id,
        doc_id: event.doc_id,
        case_ref: event.correlation_id,
      },
    }),
  );
}
