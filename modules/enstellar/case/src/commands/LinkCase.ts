import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import type { LinkCaseInput } from '../aggregate/types.js';

export interface LinkCaseResult {
  caseId: string;
}

/**
 * LinkCase — updates ens.case linked JSONB + ens.case_event + shared.outbox
 * all in ONE transaction.
 */
export async function linkCase(
  db: TenantDb,
  input: LinkCaseInput
): Promise<LinkCaseResult> {
  const tenantCtx = ctx();
  const eventId = randomUUID();

  const linked = {
    appeal_of: input.appealOf ?? null,
    related_cases: input.relatedCases ?? [],
  };

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [input.caseId]
    );

    // 1. UPDATE ens.case linked JSONB
    const updateResult = await client.query(
      `UPDATE ens.case
       SET linked = $1,
           updated_at = now()
       WHERE case_id = $2
         AND tenant_id = $3`,
      [JSON.stringify(linked), input.caseId, tenantCtx.tenant_id]
    );
    if ((updateResult as unknown as { rowCount: number | null }).rowCount === 0) {
      throw new Error(`Case not found: ${input.caseId}`);
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
      linked,
    };
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, 'CaseLinked', $4, $5, $6, $7)`,
      [
        input.caseId,
        nextSeq,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/CaseLinked/v1',
        JSON.stringify(payload),
        JSON.stringify({ type: 'service', id: 'enstellar-case' }),
        eventId,
      ]
    );

    // 3. INSERT shared.outbox
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/CaseLinked/v1',
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

  return { caseId: input.caseId };
}
