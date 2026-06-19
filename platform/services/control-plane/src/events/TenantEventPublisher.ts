import { randomUUID } from "node:crypto";
import { topicFor } from "@sim/outbox-ts";
import type { EventEnvelope } from "@sim/outbox-ts";
import type { CtrlClient } from "../db/index.js";

/**
 * Publishes tenant-admin domain events to shared.outbox within an existing
 * ctrl-db transaction, guaranteeing exactly-once delivery via the outbox relay.
 *
 * The caller MUST pass the PoolClient that is currently inside BEGIN/COMMIT so
 * the event write is atomic with the triggering state change.
 */
export class TenantEventPublisher {
  /**
   * Write an event envelope into shared.outbox using the supplied in-flight
   * transaction client.  The insert is idempotent (ON CONFLICT DO NOTHING).
   */
  async publishInTransaction(
    client: CtrlClient,
    eventType: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope: EventEnvelope = {
      event_id: randomUUID(),
      schema_ref: eventType,
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantId },
      correlation_id: tenantId,
      causation_id: null,
      actor: { type: "service", id: "control-plane" },
      trace_ref: null,
      payload,
    };

    const topic = topicFor(eventType);

    await client.query("SELECT set_config('sim.tenant_id', $1, true)", [tenantId]);

    await client.query(
      `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.event_id,
        topic,
        envelope.correlation_id,
        JSON.stringify(envelope),
        tenantId,
      ],
    );
  }
}
