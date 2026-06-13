import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import type { AppendPinInput } from '../aggregate/types.js';

export interface AppendPinResult {
  inserted: boolean; // false when ON CONFLICT DO NOTHING skipped the row
}

/**
 * AppendPin — inserts into ens.case_pin (existing table, UUID case_id FK).
 * Pins are append-only: ON CONFLICT (case_id, canonical_url) DO NOTHING is correct.
 *
 * Also emits a PinAppended event + outbox entry in the same transaction.
 */
export async function appendPin(
  db: TenantDb,
  input: AppendPinInput
): Promise<AppendPinResult> {
  const tenantCtx = ctx();
  const eventId = randomUUID();
  let inserted = false;

  await db.transaction(async (client) => {
    // Serialize concurrent appends to the same case using advisory lock
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [input.caseId]
    );

    // 1. INSERT ens.case_pin — DO NOTHING on conflict (already-pinned version)
    const pinResult = await client.query(
      `INSERT INTO ens.case_pin (case_id, tenant_id, canonical_url, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (case_id, canonical_url) DO NOTHING`,
      [input.caseId, tenantCtx.tenant_id, input.canonicalUrl, input.version]
    );

    // pg returns rowCount=0 when DO NOTHING fires
    const rowCount = (pinResult as unknown as { rowCount: number | null }).rowCount ?? 0;
    inserted = rowCount > 0;

    // Only emit the event if we actually inserted (idempotent)
    if (inserted) {
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
        canonical_url: input.canonicalUrl,
        version: input.version,
      };
      await client.query(
        `INSERT INTO ens.case_event
           (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
         VALUES ($1, $2, $3, 'PinAppended', $4, $5, $6, $7)`,
        [
          input.caseId,
          nextSeq,
          tenantCtx.tenant_id,
          'sim.case.lifecycle/PinAppended/v1',
          JSON.stringify(payload),
          JSON.stringify({ type: 'service', id: 'enstellar-case' }),
          eventId,
        ]
      );

      // 3. INSERT shared.outbox
      const envelope: EventEnvelope = {
        event_id: eventId,
        schema_ref: 'sim.case.lifecycle/PinAppended/v1',
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
    }
  });

  return { inserted };
}
