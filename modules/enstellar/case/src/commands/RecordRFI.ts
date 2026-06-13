import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import type { RecordRFIInput } from '../aggregate/types.js';

export interface RecordRFIResult {
  rfiId: string;
}

/**
 * RecordRFI — inserts ens.rfi + ens.case_event + shared.outbox in ONE transaction.
 */
export async function recordRFI(
  db: TenantDb,
  input: RecordRFIInput
): Promise<RecordRFIResult> {
  const tenantCtx = ctx();
  const eventId = randomUUID();

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [input.caseId]
    );

    // 1. INSERT ens.rfi
    await client.query(
      `INSERT INTO ens.rfi
         (rfi_id, case_id, tenant_id, requirement_ids, channel, issued_at, due_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')`,
      [
        input.rfiId,
        input.caseId,
        tenantCtx.tenant_id,
        JSON.stringify(input.requirementIds),
        input.channel,
        input.issuedAt,
        input.dueBy,
      ]
    );

    // 2. INSERT ens.case_event
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
       FROM ens.case_event
       WHERE case_id = $1`,
      [input.caseId]
    );
    const seqRow = seqResult.rows[0];
    const nextSeq = seqRow !== undefined ? (seqRow['next_seq'] as number) : 1;

    const payload = {
      case_id: input.caseId,
      rfi_id: input.rfiId,
      channel: input.channel,
      issued_at: input.issuedAt,
      due_by: input.dueBy,
      requirement_ids: input.requirementIds,
    };
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, 'RfiIssued', $4, $5, $6, $7)`,
      [
        input.caseId,
        nextSeq,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/RfiIssued/v1',
        JSON.stringify(payload),
        JSON.stringify({ type: 'service', id: 'enstellar-case' }),
        eventId,
      ]
    );

    // 3. INSERT shared.outbox
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/RfiIssued/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: `case_${input.caseId}`,
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

  return { rfiId: input.rfiId };
}
