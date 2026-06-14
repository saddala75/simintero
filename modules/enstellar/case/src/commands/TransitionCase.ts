import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import { adverseTransitionGuard, TransitionGuardError } from '../guards/AdverseTransitionGuard.js';

export { TransitionGuardError };

export interface TransitionCaseInput {
  caseId: string;
  fromState: string;
  toState: string;
  trigger: string;
  humanSignoffRecorded?: boolean;
  actorType?: 'human' | 'service' | 'model_agent';
  actorId?: string;
  /**
   * Optional idempotency key — maps to event_id.
   * When supplied, a second call with the same key returns the original result
   * without a second DB write.
   */
  idempotencyKey?: string;
}

export interface TransitionCaseResult {
  eventId: string;
  seq: number;
}

export async function transitionCase(
  db: TenantDb,
  input: TransitionCaseInput,
): Promise<TransitionCaseResult> {
  const tenantCtx = ctx();

  // Guard before any DB write — INVARIANT #1
  adverseTransitionGuard(input.toState, input.humanSignoffRecorded ?? false);

  const eventId = input.idempotencyKey ?? randomUUID();
  let seq = 0;

  await db.transaction(async (client) => {
    // Advisory lock — serialize concurrent writes for this case
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.caseId]);

    // Idempotency check — if this event_id is already recorded, return early
    const dedupResult = await client.query(
      `SELECT seq FROM ens.case_event WHERE event_id = $1`,
      [eventId],
    );
    if (dedupResult.rows.length > 0) {
      seq = dedupResult.rows[0]!['seq'] as number;
      return; // already processed
    }

    // Compute next seq
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM ens.case_event WHERE case_id = $1`,
      [input.caseId],
    );
    seq = (seqResult.rows[0]!['next_seq'] as number) ?? 1;

    const payload = {
      case_id: input.caseId,
      from: input.fromState,
      to: input.toState,
      trigger: input.trigger,
    };
    const actor = {
      type: input.actorType ?? 'service',
      id: input.actorId ?? 'enstellar-workflow',
    };

    // INSERT ens.case_event
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, 'CaseStateChanged', $4, $5, $6, $7)`,
      [
        input.caseId,
        seq,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/CaseStateChanged/v1',
        JSON.stringify(payload),
        JSON.stringify(actor),
        eventId,
      ],
    );

    // UPDATE ens.case.state — first time ens.case.state is ever written after INSERT
    await client.query(
      `UPDATE ens.case SET state = $1, updated_at = now() WHERE case_id = $2 AND tenant_id = $3`,
      [input.toState, input.caseId, tenantCtx.tenant_id],
    );

    // INSERT shared.outbox (same transaction — atomicity)
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/CaseStateChanged/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: `case_${input.caseId}`,
      causation_id: null,
      actor,
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
      ],
    );
  });

  return { eventId, seq };
}
