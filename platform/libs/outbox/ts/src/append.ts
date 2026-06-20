import { ulid } from 'ulid';
import { topicFor, type EventActor } from './index.js';
import type { DbClient } from './types.js';

export interface AppendOpts {
  schemaRef: string;
  tenantId: string;
  payload: Record<string, unknown>;
  topic?: string;
  correlationId?: string;
  causationId?: string | null;
  actor?: EventActor;
}

export async function appendEvent(client: DbClient, opts: AppendOpts): Promise<string> {
  const eventId = `evt_${ulid()}`;
  const correlationId = opts.correlationId ?? opts.tenantId;
  const envelope = {
    event_id: eventId,
    schema_ref: opts.schemaRef,
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: opts.tenantId },
    correlation_id: correlationId,
    causation_id: opts.causationId ?? null,
    actor: opts.actor ?? { type: 'service' as const, id: 'platform' },
    trace_ref: null,
    payload: opts.payload,
  };
  const topic = opts.topic ?? topicFor(opts.schemaRef);
  await client.query(
    `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING`,
    [eventId, topic, correlationId, JSON.stringify(envelope), opts.tenantId],
  );
  return eventId;
}
