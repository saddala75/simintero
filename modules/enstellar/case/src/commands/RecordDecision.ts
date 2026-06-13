import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import { authorize } from '@sim/authz-client-ts';
import type { RecordDecisionInput } from '../aggregate/types.js';

export interface RecordDecisionResult {
  determinationId: string;
}

/**
 * RecordDecision — adverse-action guard via OPA BEFORE any write.
 * Inserts ens.determination + ens.case_event + shared.outbox in ONE transaction.
 *
 * authorize() throws { code: 'SIM-AUTHZ-0001', status: 403 } if the principal
 * is not a human medical_director attempting a denied/modified outcome.
 */
export async function recordDecision(
  db: TenantDb,
  input: RecordDecisionInput
): Promise<RecordDecisionResult> {
  const tenantCtx = ctx();

  // MUST call authorize() before ANY write
  await authorize(
    {
      action: 'adverse_action',
      resource: {
        case_id: input.caseId,
        outcome: input.outcome,
        decided_by: input.decidedBy,
      },
    },
    'sim/guards/adverse_action/allow'
  );

  const determinationId = randomUUID();
  const eventId = randomUUID();

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [input.caseId]
    );

    // 1. INSERT ens.determination
    await client.query(
      `INSERT INTO ens.determination
         (determination_id, case_id, tenant_id, outcome, per_line, decided_by,
          auto_path, rationale_ref, rules_trace_ref, advisory_analysis_ref, pins, supersedes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        determinationId,
        input.caseId,
        tenantCtx.tenant_id,
        input.outcome,
        JSON.stringify(input.perLine ?? []),
        JSON.stringify(input.decidedBy),
        input.autoPath ?? false,
        input.rationaleRef ?? null,
        input.rulesTraceRef ?? null,
        input.advisoryAnalysisRef ?? null,
        JSON.stringify(input.pins ?? []),
        input.supersedes ?? null,
      ]
    );

    // 2. INSERT ens.case_event
    // seq = MAX(seq) + 1 within the transaction
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
      determination_id: determinationId,
      outcome: input.outcome,
      decided_by: input.decidedBy,
    };
    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, 'DeterminationRecorded', $4, $5, $6, $7)`,
      [
        input.caseId,
        nextSeq,
        tenantCtx.tenant_id,
        'sim.case.lifecycle/DeterminationRecorded/v1',
        JSON.stringify(payload),
        JSON.stringify(input.decidedBy),
        eventId,
      ]
    );

    // 3. INSERT shared.outbox (inline — same transaction)
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/DeterminationRecorded/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: `case_${input.caseId}`,
      causation_id: null,
      actor: { type: input.decidedBy.type, id: input.decidedBy.id },
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

  return { determinationId };
}
