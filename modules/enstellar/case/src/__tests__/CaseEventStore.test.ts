import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { CaseEventStore } from '../events/CaseEventStore.js';
import type { CaseState } from '../aggregate/types.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

const CASE_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Build a mock TenantDb that simulates ens.case + ens.case_event rows.
 */
function makeReplayDb(storedEvents: Array<{ seq: number; event_type: string; payload: Record<string, unknown> }>): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      let callCount = 0;
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          callCount++;
          // First query is ens.case SELECT
          if (sql.includes('FROM ens.case') && !sql.includes('ens.case_event')) {
            return {
              rows: [{
                case_id: CASE_ID,
                tenant_id: 't_test',
                state: 'intake',
                urgency: 'standard',
                channel: 'PAS',
                lob: 'MA',
                member_ref: 'Patient/pat-001',
                coverage_ref: 'Coverage/cov-001',
                linked: { appeal_of: null, related_cases: [] },
              }],
            };
          }
          // Second query is ens.case_event SELECT (replay)
          if (sql.includes('FROM ens.case_event')) {
            return {
              rows: storedEvents.map((e) => ({
                case_id: CASE_ID,
                seq: e.seq,
                event_type: e.event_type,
                schema_ref: `sim.case.lifecycle/${e.event_type}/v1`,
                payload: e.payload,
                actor: { type: 'service', id: 'enstellar-case' },
                occurred_at: new Date().toISOString(),
                trace_ref: null,
              })),
            };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

/**
 * Build a mock TenantDb for appendInTx — simulates COALESCE seq query.
 */
function makeAppendDb(
  initialMaxSeq: number,
  captured: Array<{ sql: string; params: unknown[] }>
): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      let seqCallCount = 0;
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          captured.push({ sql, params: params ?? [] });
          if (sql.includes('COALESCE(MAX(seq)')) {
            seqCallCount++;
            return { rows: [{ next_seq: initialMaxSeq + seqCallCount }] };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('CaseEventStore', () => {
  it('replay of 3 events reconstructs CaseState with status = last CaseStateChanged.to', async () => {
    const storedEvents = [
      {
        seq: 1,
        event_type: 'CaseCreated',
        payload: { case_id: CASE_ID, channel: 'PAS', urgency: 'standard' },
      },
      {
        seq: 2,
        event_type: 'CaseStateChanged',
        payload: { case_id: CASE_ID, to: 'completeness_check', trigger: 'case.created' },
      },
      {
        seq: 3,
        event_type: 'CaseStateChanged',
        payload: { case_id: CASE_ID, to: 'clinical_review', trigger: 'completeness.complete' },
      },
    ];

    const db = makeReplayDb(storedEvents);
    const store = new CaseEventStore(db);

    const { seed, events } = await withTenantContext(TEST_CONTEXT, () =>
      store.loadForReplay(CASE_ID)
    );

    // Replay manually to reconstruct state
    const { replayEvents } = await import('../aggregate/reducers.js');
    const finalState: CaseState = replayEvents(seed, events);

    // Status should be the last CaseStateChanged.to
    expect(finalState.status).toBe('clinical_review');
    // Events accumulated
    expect(finalState.events).toHaveLength(3);
  });

  it('seq increments correctly (1, 2, 3) across three appends', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeAppendDb(0, captured);
    const store = new CaseEventStore(db);

    await withTenantContext(TEST_CONTEXT, async () => {
      // Simulate three separate appendInTx calls inside a transaction
      await db.transaction(async (client) => {
        const seq1 = await store.appendInTx(
          client,
          { type: 'CaseCreated', case_id: CASE_ID, payload: { case_id: CASE_ID } },
          { type: 'service', id: 'enstellar-case' }
        );
        const seq2 = await store.appendInTx(
          client,
          {
            type: 'CaseStateChanged',
            case_id: CASE_ID,
            to: 'completeness_check',
            trigger: 'case.created',
            payload: {},
          },
          { type: 'service', id: 'enstellar-case' }
        );
        const seq3 = await store.appendInTx(
          client,
          {
            type: 'CaseStateChanged',
            case_id: CASE_ID,
            to: 'clinical_review',
            trigger: 'completeness.complete',
            payload: {},
          },
          { type: 'service', id: 'enstellar-case' }
        );
        expect(seq1).toBe(1);
        expect(seq2).toBe(2);
        expect(seq3).toBe(3);
      });
    });

    // Verify all 3 INSERT statements were captured
    const inserts = captured.filter((q) => q.sql.includes('INSERT INTO ens.case_event'));
    expect(inserts).toHaveLength(3);
  });

  it('replay returns empty events list for a brand-new case', async () => {
    const db = makeReplayDb([]);
    const store = new CaseEventStore(db);

    const { seed, events } = await withTenantContext(TEST_CONTEXT, () =>
      store.loadForReplay(CASE_ID)
    );

    expect(events).toHaveLength(0);
    expect(seed.caseId).toBe(CASE_ID);
    expect(seed.status).toBe('intake');
  });
});
