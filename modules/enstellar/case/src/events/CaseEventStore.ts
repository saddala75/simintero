import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, DbClient } from '@sim/outbox-ts';
import type { CaseEvent, CaseState, CaseStatus } from '../aggregate/types.js';

export interface StoredEvent {
  case_id: string;
  seq: number;
  event_type: string;
  schema_ref: string | null;
  payload: Record<string, unknown>;
  actor: Record<string, unknown>;
  occurred_at: string;
  trace_ref: string | null;
}

/**
 * CaseEventStore — append to ens.case_event; replay from event log by case_id.
 *
 * Uses Phase 0 + V006 column layout:
 *   case_id UUID, seq INT, event_type TEXT, schema_ref TEXT,
 *   payload JSONB, actor JSONB, occurred_at TIMESTAMPTZ,
 *   event_id TEXT (added by V006)
 */
export class CaseEventStore {
  constructor(private readonly db: TenantDb) {}

  /**
   * Append a single event inside an existing transaction client.
   * The caller is responsible for wrapping in db.transaction().
   *
   * Returns the seq assigned to this event.
   */
  async appendInTx(
    client: DbClient,
    event: CaseEvent,
    actor: { type: string; id: string }
  ): Promise<number> {
    const tenantCtx = ctx();

    // Compute next seq atomically within the transaction
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
       FROM ens.case_event
       WHERE case_id = $1`,
      [event.case_id]
    );

    const row = seqResult.rows[0];
    const nextSeq = row !== undefined ? (row['next_seq'] as number) : 1;
    const eventId = randomUUID();
    const schemaRef = `sim.case.lifecycle/${event.type}/v1`;

    await client.query(
      `INSERT INTO ens.case_event
         (case_id, seq, tenant_id, event_type, schema_ref, payload, actor, event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.case_id,
        nextSeq,
        tenantCtx.tenant_id,
        event.type,
        schemaRef,
        JSON.stringify(event.payload),
        JSON.stringify(actor),
        eventId,
      ]
    );

    return nextSeq;
  }

  /**
   * Load raw stored events for replay — returns seed state scaffold + events.
   * The seed is built from ens.case row data; then reducers replay events on top.
   */
  async loadForReplay(
    caseId: string
  ): Promise<{ seed: CaseState; events: CaseEvent[] }> {
    let seed: CaseState | null = null;
    let events: CaseEvent[] = [];

    await this.db.transaction(async (client: DbClient) => {
      // Load the ens.case row for the seed
      const caseResult = await client.query(
        `SELECT case_id, tenant_id, state, urgency, channel, lob, member_ref, coverage_ref, linked
         FROM ens.case
         WHERE case_id = $1`,
        [caseId]
      );

      const caseRow = caseResult.rows[0];
      if (!caseRow) {
        throw new Error(`Case not found: ${caseId}`);
      }

      const linked = (caseRow['linked'] as { appeal_of: string | null; related_cases: string[] } | null) ??
        { appeal_of: null, related_cases: [] };

      seed = {
        caseId: caseRow['case_id'] as string,
        tenantId: caseRow['tenant_id'] as string,
        status: caseRow['state'] as CaseStatus,
        urgency: caseRow['urgency'] as 'standard' | 'expedited',
        channel: caseRow['channel'] as string,
        lob: caseRow['lob'] as string,
        memberRef: (caseRow['member_ref'] as string | null) ?? null,
        coverageRef: (caseRow['coverage_ref'] as string | null) ?? null,
        pins: [],
        linked,
        events: [],
      };

      // Load all events in seq order
      const eventsResult = await client.query(
        `SELECT case_id, seq, event_type, schema_ref, payload, actor, occurred_at, trace_ref
         FROM ens.case_event
         WHERE case_id = $1
         ORDER BY seq ASC`,
        [caseId]
      );

      events = eventsResult.rows.map((r) => {
        const eventType = r['event_type'] as string;
        const payload = r['payload'] as Record<string, unknown>;
        const cid = r['case_id'] as string;

        switch (eventType) {
          case 'CaseCreated':
            return { type: 'CaseCreated', case_id: cid, payload } as CaseEvent;
          case 'CaseStateChanged':
            return {
              type: 'CaseStateChanged',
              case_id: cid,
              to: payload['to'] as CaseStatus,
              trigger: payload['trigger'] as string,
              payload,
            } as CaseEvent;
          case 'DeterminationRecorded':
            return {
              type: 'DeterminationRecorded',
              case_id: cid,
              outcome: payload['outcome'] as string,
              payload,
            } as CaseEvent;
          case 'PinAppended':
            return {
              type: 'PinAppended',
              case_id: cid,
              canonical_url: payload['canonical_url'] as string,
              version: payload['version'] as string,
              payload,
            } as CaseEvent;
          case 'RfiIssued':
            return {
              type: 'RfiIssued',
              case_id: cid,
              rfi_id: payload['rfi_id'] as string,
              payload,
            } as CaseEvent;
          case 'RfiSatisfied':
            return {
              type: 'RfiSatisfied',
              case_id: cid,
              rfi_id: payload['rfi_id'] as string,
              payload,
            } as CaseEvent;
          case 'CaseLinked':
            return { type: 'CaseLinked', case_id: cid, payload } as CaseEvent;
          default:
            // Unknown event types from the DB are surfaced as CaseCreated with the raw payload
            return { type: 'CaseCreated', case_id: cid, payload } as CaseEvent;
        }
      });
    });

    if (!seed) {
      throw new Error(`Failed to load case: ${caseId}`);
    }

    return { seed, events };
  }
}
