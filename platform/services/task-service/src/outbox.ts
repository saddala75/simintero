import type { PoolClient } from 'pg';
import { ulid } from 'ulid';

export type TaskEvent = 'TaskCreated' | 'TaskAssigned' | 'TaskResolved' | 'TaskCancelled';

export async function appendTaskEvent(
  client: PoolClient,
  tenantId: string,
  event: TaskEvent,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const eventId = 'evt_' + ulid();
  const envelope = {
    event_id: eventId,
    schema_ref: `sim.task.lifecycle/${event}/v1`,
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    correlation_id: taskId,
    payload: { ...payload, task_id: taskId },
  };
  await client.query(
    `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [eventId, 'sim.task.lifecycle', taskId, JSON.stringify(envelope), tenantId],
  );
}
