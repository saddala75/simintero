import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import type { SatisfyRFIInput } from '../aggregate/types.js';

export interface SatisfyRFIResult {
  rfiId: string;
}

/**
 * SatisfyRFI — updates ens.rfi status='satisfied' + ens.case_event + shared.outbox
 * all in ONE transaction.
 */
export async function satisfyRFI(
  db: TenantDb,
  input: SatisfyRFIInput
): Promise<SatisfyRFIResult> {
  const tenantCtx = ctx();
  const eventId = randomUUID();

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [input.caseId]
    );

    // 1. UPDATE ens.rfi status='satisfied'
    const updateResult = await client.query(
      `UPDATE ens.rfi
       SET status = 'satisfied',
           satisfied_by = $1
       WHERE rfi_id = $2
         AND tenant_id = $3
         AND status = 'open'`,
      [
        JSON.stringify(input.satisfiedBy ?? []),
        input.rfiId,
        tenantCtx.tenant_id,
      ]
    );
    if ((updateResult as unknown as { rowCount: number | null }).rowCount === 0) {
      throw new Error(`RFI ${input.rfiId} not found or not open`);
    }

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
      satisfied_by: input.satisfiedBy ?? [],
    };
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, 'RfiSatisfied', $4, $5, $6, $7)`,
      [
        input.caseId,
        nextSeq,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/RfiSatisfied/v1',
        JSON.stringify(payload),
        JSON.stringify({ type: 'service', id: 'enstellar-case' }),
        eventId,
      ]
    );

    // 3. INSERT shared.outbox
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/RfiSatisfied/v1',
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
