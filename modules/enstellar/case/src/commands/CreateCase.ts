import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import type { CreateCaseInput } from '../aggregate/types.js';

export interface CreateCaseResult {
  caseId: string;
}

/**
 * CreateCase — inserts ens.case + ens.case_event (seq=1, CaseCreated) + shared.outbox
 * all in a single db.transaction() for atomicity.
 */
export async function createCase(
  db: TenantDb,
  input: CreateCaseInput
): Promise<CreateCaseResult> {
  const tenantCtx = ctx();
  const caseId = randomUUID();
  const eventId = randomUUID();

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [caseId]
    );

    // 1. INSERT ens.case
    await client.query(
      `INSERT INTO ens.case
         (case_id, tenant_id, lob, state, urgency, channel, member_ref, coverage_ref, origin, providers)
       VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7, $8, $9)`,
      [
        caseId,
        tenantCtx.tenant_id,
        input.lob,
        input.urgency,
        input.channel,
        input.memberRef ?? null,
        input.coverageRef ?? null,
        JSON.stringify(input.origin ?? {}),
        JSON.stringify(input.providers ?? {}),
      ]
    );

    // 2. INSERT ens.case_event (seq=1, CaseCreated)
    const payload = {
      case_id: caseId,
      channel: input.channel,
      urgency: input.urgency,
      lob: input.lob,
    };
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, 1, $2, 'CaseCreated', $3, $4, $5, $6)`,
      [
        caseId,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/CaseCreated/v1',
        JSON.stringify(payload),
        JSON.stringify({ type: 'service', id: 'enstellar-case' }),
        eventId,
      ]
    );

    // 3. INSERT shared.outbox (inline — same transaction for atomicity)
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/CaseCreated/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: `case_${caseId}`,
      causation_id: null,
      actor: { type: 'service', id: 'enstellar-case' },
      trace_ref: null,
      payload,
    };
    await client.query(
      `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        eventId,
        topicFor(envelope.schema_ref),
        envelope.correlation_id,
        JSON.stringify(envelope),
        tenantCtx.tenant_id,
      ]
    );
  });

  return { caseId };
}
