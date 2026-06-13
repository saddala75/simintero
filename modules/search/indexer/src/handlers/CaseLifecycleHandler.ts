import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { IndexClient } from '../IndexClient.js';

export interface CaseLifecycleEvent {
  event_id: string;
  tenant_id: string;
  event_type: string;  // 'CaseDetermined' | 'CaseClosed' | others (skip)
  case_ref: string;
  member_id: string;
  status?: string;
}

export async function handleCaseLifecycleEvent(
  event: CaseLifecycleEvent,
  pool: Pool,
  indexClient: IndexClient,
): Promise<void> {
  // 1. Skip unhandled event types
  if (event.event_type !== 'CaseDetermined' && event.event_type !== 'CaseClosed') {
    return;
  }

  // 2. Idempotency check
  const { rows: seen } = await pool.query(
    `SELECT 1 FROM search.index_event WHERE tenant_id = $1 AND entity_type = 'case' AND entity_id = $2 LIMIT 1`,
    [event.tenant_id, event.case_ref],
  );
  if (seen.length > 0) return;

  // 3. Build IndexDocument
  const content_hash = createHash('sha256')
    .update(event.case_ref + event.event_type)
    .digest('hex');

  const doc = {
    entity_type: 'case' as const,
    entity_id: event.case_ref,
    tenant_id: event.tenant_id,
    content_hash,
    metadata: { status: event.event_type, member_id: event.member_id },
    indexed_at: new Date().toISOString(),
  };

  // 4. Upsert to index
  await indexClient.upsert(doc);

  // 5. Record idempotency
  await pool.query(
    `INSERT INTO search.index_event (event_id, tenant_id, entity_type, entity_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [event.event_id, event.tenant_id, 'case', event.case_ref],
  );

  // 6. Emit to outbox
  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload) VALUES ($1, 'sim.search.indexed', $2)`,
    [
      event.tenant_id,
      JSON.stringify({
        event_type: 'EntityIndexed',
        entity_type: 'case',
        entity_id: event.case_ref,
        source_event_id: event.event_id,
      }),
    ],
  );
}
