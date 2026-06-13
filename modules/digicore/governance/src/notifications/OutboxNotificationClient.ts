import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createOutbox } from '@sim/outbox-ts';
import type { TenantDb, DbClient, EventEnvelope } from '@sim/outbox-ts';
import type { NotificationClient } from './GovernanceNotifier.js';

/**
 * Build a minimal TenantDb adapter from a pg.Pool.
 *
 * Governance does not yet carry request-scoped tenant context, so we skip the
 * SET sim.tenant_id call that createTenantDb() performs and rely on the
 * envelope's tenant field for the outbox INSERT instead.  A later phase will
 * add the tenant-context middleware and switch to createTenantDb.
 */
function poolToTenantDb(pool: Pool): TenantDb {
  return {
    async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      let released = false;
      try {
        await client.query('BEGIN');
        const result = await fn(client as unknown as DbClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        let destroy = false;
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
        client.release(destroy);
        released = true;
        throw err;
      } finally {
        if (!released) client.release();
      }
    },
  };
}

export class OutboxNotificationClient implements NotificationClient {
  private readonly outbox: ReturnType<typeof createOutbox>;

  constructor(pool: Pool) {
    this.outbox = createOutbox(poolToTenantDb(pool));
  }

  async emit(event: {
    event_type: string;
    artifact_id: string;
    gate?: string;
    decision?: string;
  }): Promise<void> {
    // Governance events are prefixed sim.artifact.* — topicFor() maps them to
    // the "sim.artifact" topic.  Append /v1 to form a well-structured schema_ref.
    const schemaRef = `${event.event_type}/v1`;

    const envelope: EventEnvelope = {
      event_id: randomUUID(),
      schema_ref: schemaRef,
      occurred_at: new Date().toISOString(),
      // Tenant context is not yet request-scoped in governance; fall back to the
      // GOVERNANCE_TENANT_ID env-var so the outbox row is never written with an
      // empty tenant_id.  Phase 3 will replace this with ctx().tenant_id.
      tenant: { tenant_id: process.env['GOVERNANCE_TENANT_ID'] ?? 'system' },
      correlation_id: `artifact_${event.artifact_id}`,
      causation_id: null,
      actor: { type: 'service', id: 'digicore-governance' },
      trace_ref: null,
      payload: {
        artifact_id: event.artifact_id,
        ...(event.gate !== undefined && { gate: event.gate }),
        ...(event.decision !== undefined && { decision: event.decision }),
      },
    };

    await this.outbox.append(envelope);
  }
}
