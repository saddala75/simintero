import type { DbClient, TenantDb } from "./types.js";

export type { DbClient, TenantDb } from "./types.js";

export interface EventActor {
  type: "human" | "service" | "model_agent";
  id: string;
}

export interface EventEnvelope {
  event_id: string;
  schema_ref: string;
  occurred_at: string;
  tenant: { tenant_id: string };
  correlation_id: string;
  causation_id: string | null;
  actor: EventActor;
  trace_ref: string | null;
  payload: Record<string, unknown>;
}

export function createOutbox(db: TenantDb) {
  return {
    async append(envelope: EventEnvelope): Promise<void> {
      const topic = topicFor(envelope.schema_ref);
      await db.transaction(async (client: DbClient) => {
        await client.query(
          `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            envelope.event_id,
            topic,
            envelope.correlation_id,
            JSON.stringify(envelope),
            envelope.tenant.tenant_id,
          ]
        );
      });
    },
  };
}

export function topicFor(schemaRef: string): string {
  if (schemaRef.startsWith("sim.case.")) return "sim.case.lifecycle";
  if (schemaRef.startsWith("sim.evidence.")) return "sim.evidence";
  if (schemaRef.startsWith("sim.artifact.")) return "sim.artifact";
  if (schemaRef.startsWith("sim.ai.")) return "sim.ai.interaction";
  if (schemaRef.startsWith("sim.clock.")) return "sim.clock";
  if (schemaRef.startsWith("sim.tenant.")) return "sim.tenant.admin";
  throw new Error(`Unknown schema_ref prefix: ${schemaRef}`);
}
