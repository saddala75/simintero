/**
 * T1 Exit Criterion: proxy-Qualitron stub — case state replay from ens.case_event
 *
 * Proves that given ONLY the ens.case_event rows (the event log), a pure fold
 * function can reconstruct the current ens.case.state for any case — i.e. that
 * sim.case.lifecycle/CaseStateChanged events alone are sufficient to replay case
 * state without reading the case row directly.
 *
 * Five synthetic cases with different state chains are advanced via the real
 * POST /internal/transitions/notify endpoint.  After each chain the test:
 *   1. Queries ens.case_event (events only — no ens.case read) and folds them
 *      with projectCaseState().
 *   2. Queries ens.case.state directly.
 *   3. Asserts (a) folded == expected final state, and (b) folded == DB state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import app, { setDb } from '../server.js';
import type { TenantDb, DbClient } from '@sim/outbox-ts';

// ---------------------------------------------------------------------------
// DB / tenant setup (mirrors transitions-notify.test.ts)
// ---------------------------------------------------------------------------

const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero';
const TENANT = 'tenant-t1-exit';

function makeTenantDb(pool: Pool): TenantDb {
  return {
    async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [TENANT]);
        const result = await fn({
          async query(sql: string, params?: unknown[]) {
            return client.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Seeds a fresh case in 'intake' state, returns its UUID. */
async function seedCase(pool: Pool): Promise<string> {
  const caseId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [TENANT]);
    await client.query(
      `INSERT INTO ens.case (case_id, tenant_id, lob, state, urgency, channel)
       VALUES ($1, $2, 'MA', 'intake', 'standard', 'PAS')`,
      [caseId, TENANT],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  return caseId;
}

// ---------------------------------------------------------------------------
// Pure event-fold function — the heart of the T1 exit criterion
//
// Takes ONLY ens.case_event rows; never touches ens.case.  Returns the
// projected current state by sorting events chronologically and applying
// each CaseStateChanged in order.
// ---------------------------------------------------------------------------

type CaseEvent = {
  event_type: string;
  payload: { from: string; to: string; trigger: string };
  occurred_at: Date;
};

function projectCaseState(events: CaseEvent[]): string {
  // Sort by occurred_at ascending (events arrive in order but confirm sort)
  const sorted = [...events].sort(
    (a, b) => a.occurred_at.getTime() - b.occurred_at.getTime(),
  );
  let state = 'intake'; // initial state
  for (const ev of sorted) {
    if (ev.event_type === 'CaseStateChanged') {
      state = ev.payload.to;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Helper: POST one transition hop
// ---------------------------------------------------------------------------

function makeEnvelope(
  caseId: string,
  from: string,
  to: string,
  trigger: string,
) {
  return {
    event_id: crypto.randomUUID(),
    schema_ref: 'sim.case.lifecycle/CaseStateChanged/v1',
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: TENANT },
    correlation_id: `case_${caseId}`,
    causation_id: null,
    actor: { type: 'service', id: 'enstellar-workflow' },
    trace_ref: null,
    payload: { case_id: caseId, from, to, trigger },
  };
}

async function postTransition(
  caseId: string,
  from: string,
  to: string,
  trigger: string,
): Promise<void> {
  const res = await request(app)
    .post('/internal/transitions/notify')
    .set('x-sim-tenant-id', TENANT)
    .send(makeEnvelope(caseId, from, to, trigger));
  if (res.status !== 200) {
    throw new Error(
      `Transition ${from}→${to} failed with ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: query ens.case_event for a case (events only — no ens.case read)
// ---------------------------------------------------------------------------

async function fetchEvents(pool: Pool, caseId: string): Promise<CaseEvent[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [TENANT]);
    const result = await client.query(
      `SELECT event_type, payload, occurred_at
         FROM ens.case_event
        WHERE case_id = $1
        ORDER BY occurred_at ASC`,
      [caseId],
    );
    await client.query('ROLLBACK');
    return result.rows.map((row) => ({
      event_type: row['event_type'] as string,
      payload:
        typeof row['payload'] === 'string'
          ? (JSON.parse(row['payload'] as string) as { from: string; to: string; trigger: string })
          : (row['payload'] as { from: string; to: string; trigger: string }),
      occurred_at: row['occurred_at'] as Date,
    }));
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helper: query ens.case.state directly (to assert consistency)
// ---------------------------------------------------------------------------

async function fetchCaseState(pool: Pool, caseId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [TENANT]);
    const result = await client.query(
      `SELECT state FROM ens.case WHERE case_id = $1`,
      [caseId],
    );
    await client.query('ROLLBACK');
    const row = result.rows[0] as { state: string } | undefined;
    if (!row) throw new Error(`Case ${caseId} not found in ens.case`);
    return row.state;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// T1 Exit Criterion: 5 synthetic cases
// ---------------------------------------------------------------------------

/**
 * Case chains:
 *
 * C1: intake → pending_documents                                                    (1 hop)
 * C2: intake → pending_documents → under_review                                     (2 hops)
 * C3: intake → pending_documents → under_review → clinical_review                   (3 hops)
 * C4: intake → pending_documents → under_review → clinical_review → approved        (4 hops)
 * C5: intake → under_review                                                         (1 hop, direct)
 */

describe('T1 Exit Criterion — case state replay from ens.case_event alone', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    setDb(makeTenantDb(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('C1: intake → pending_documents (1 hop)', async () => {
    const caseId = await seedCase(pool);

    await postTransition(caseId, 'intake', 'pending_documents', 'documents.requested');

    const events = await fetchEvents(pool, caseId);
    const projected = projectCaseState(events);
    const dbState = await fetchCaseState(pool, caseId);

    // (a) fold matches expected final state
    expect(projected).toBe('pending_documents');
    // (b) fold matches ens.case.state — proving event log is the authoritative source
    expect(projected).toBe(dbState);
  });

  it('C2: intake → pending_documents → under_review (2 hops)', async () => {
    const caseId = await seedCase(pool);

    await postTransition(caseId, 'intake', 'pending_documents', 'documents.requested');
    await postTransition(caseId, 'pending_documents', 'under_review', 'documents.received');

    const events = await fetchEvents(pool, caseId);
    const projected = projectCaseState(events);
    const dbState = await fetchCaseState(pool, caseId);

    expect(projected).toBe('under_review');
    expect(projected).toBe(dbState);
  });

  it('C3: intake → pending_documents → under_review → clinical_review (3 hops)', async () => {
    const caseId = await seedCase(pool);

    await postTransition(caseId, 'intake', 'pending_documents', 'documents.requested');
    await postTransition(caseId, 'pending_documents', 'under_review', 'documents.received');
    await postTransition(caseId, 'under_review', 'clinical_review', 'clinical.escalated');

    const events = await fetchEvents(pool, caseId);
    const projected = projectCaseState(events);
    const dbState = await fetchCaseState(pool, caseId);

    expect(projected).toBe('clinical_review');
    expect(projected).toBe(dbState);
  });

  it('C4: intake → pending_documents → under_review → clinical_review → approved (4 hops)', async () => {
    // 'approved' is NOT in ADVERSE_STATES, so humanSignoffRecorded is not required
    const caseId = await seedCase(pool);

    await postTransition(caseId, 'intake', 'pending_documents', 'documents.requested');
    await postTransition(caseId, 'pending_documents', 'under_review', 'documents.received');
    await postTransition(caseId, 'under_review', 'clinical_review', 'clinical.escalated');
    await postTransition(caseId, 'clinical_review', 'approved', 'decision.recorded');

    const events = await fetchEvents(pool, caseId);
    const projected = projectCaseState(events);
    const dbState = await fetchCaseState(pool, caseId);

    expect(projected).toBe('approved');
    expect(projected).toBe(dbState);
  });

  it('C5: intake → under_review (1 hop, single direct jump)', async () => {
    const caseId = await seedCase(pool);

    await postTransition(caseId, 'intake', 'under_review', 'expedited.review');

    const events = await fetchEvents(pool, caseId);
    const projected = projectCaseState(events);
    const dbState = await fetchCaseState(pool, caseId);

    expect(projected).toBe('under_review');
    expect(projected).toBe(dbState);
  });
});
