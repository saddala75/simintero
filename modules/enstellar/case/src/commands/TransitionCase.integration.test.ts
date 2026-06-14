import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb, DbClient } from '@sim/outbox-ts';
import { createCase } from './CreateCase.js';
import { transitionCase, TransitionGuardError } from './TransitionCase.js';

// ─── DB Setup ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero';

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  // Verify connectivity
  const client = await pool.connect();
  client.release();
});

afterAll(async () => {
  await pool.end();
});

/**
 * Run a query within a tenant-scoped session so RLS passes.
 * Uses set_config with is_local=false so the setting persists for the connection
 * outside of a transaction context.
 */
async function tenantQuery(
  sql: string,
  params: unknown[],
  tenantId: string,
): Promise<{ rows: Record<string, unknown>[] }> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('sim.tenant_id', $1, false)`, [tenantId]);
    return client.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>;
  } finally {
    client.release();
  }
}

// ─── TenantDb adapter ────────────────────────────────────────────────────────

function makeTenantDb(pool: Pool, tenantId: string): TenantDb {
  return {
    async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);
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

// ─── Shared test context ──────────────────────────────────────────────────────

const tenantCtx = {
  tenant_id: 'tenant-transition-test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: [], region: [], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TransitionCase integration', () => {
  it('writes CaseStateChanged event and updates ens.case.state', async () => {
    const db = makeTenantDb(pool, tenantCtx.tenant_id);

    const { caseId } = await withTenantContext(tenantCtx, () =>
      createCase(db, { channel: 'PAS', urgency: 'standard', lob: 'MA' }),
    );

    const result = await withTenantContext(tenantCtx, () =>
      transitionCase(db, {
        caseId,
        fromState: 'intake',
        toState: 'completeness_check',
        trigger: 'case.created',
        humanSignoffRecorded: false,
        actorType: 'service',
        actorId: 'enstellar-workflow',
      }),
    );

    // seq=1 is CaseCreated, so CaseStateChanged should be seq=2
    expect(result.seq).toBe(2);

    // Verify ens.case.state was updated
    const caseRow = await tenantQuery(
      `SELECT state FROM ens.case WHERE case_id = $1`,
      [caseId],
      tenantCtx.tenant_id,
    );
    expect(caseRow.rows[0]!['state']).toBe('completeness_check');

    // Verify exactly one CaseStateChanged event in ens.case_event
    const eventRows = await tenantQuery(
      `SELECT payload FROM ens.case_event WHERE case_id = $1 AND event_type = 'CaseStateChanged'`,
      [caseId],
      tenantCtx.tenant_id,
    );
    expect(eventRows.rows).toHaveLength(1);
    const payload = eventRows.rows[0]!['payload'] as Record<string, unknown>;
    expect(payload['from']).toBe('intake');
    expect(payload['to']).toBe('completeness_check');

    // Verify one row in shared.outbox with correct topic
    const outboxRows = await tenantQuery(
      `SELECT topic FROM shared.outbox WHERE event_id = $1`,
      [result.eventId],
      tenantCtx.tenant_id,
    );
    expect(outboxRows.rows).toHaveLength(1);
    expect(outboxRows.rows[0]!['topic']).toBe('sim.case.lifecycle');
  });

  it('INVARIANT #1 — denied without human signoff throws TransitionGuardError', async () => {
    const db = makeTenantDb(pool, tenantCtx.tenant_id);

    const { caseId } = await withTenantContext(tenantCtx, () =>
      createCase(db, { channel: 'PAS', urgency: 'standard', lob: 'MA' }),
    );

    await expect(
      withTenantContext(tenantCtx, () =>
        transitionCase(db, {
          caseId,
          fromState: 'intake',
          toState: 'denied',
          trigger: 'auto.deny',
          humanSignoffRecorded: false,
        }),
      ),
    ).rejects.toThrow(TransitionGuardError);

    // State must still be 'intake' — no write happened
    const caseRow = await tenantQuery(
      `SELECT state FROM ens.case WHERE case_id = $1`,
      [caseId],
      tenantCtx.tenant_id,
    );
    expect(caseRow.rows[0]!['state']).toBe('intake');
  });

  it('idempotent — repeated idempotencyKey returns same seq without duplicate write', async () => {
    const db = makeTenantDb(pool, tenantCtx.tenant_id);

    const { caseId } = await withTenantContext(tenantCtx, () =>
      createCase(db, { channel: 'PAS', urgency: 'standard', lob: 'MA' }),
    );

    const idempotencyKey = randomUUID();

    const first = await withTenantContext(tenantCtx, () =>
      transitionCase(db, {
        caseId,
        fromState: 'intake',
        toState: 'completeness_check',
        trigger: 'case.created',
        humanSignoffRecorded: false,
        idempotencyKey,
      }),
    );

    const second = await withTenantContext(tenantCtx, () =>
      transitionCase(db, {
        caseId,
        fromState: 'intake',
        toState: 'completeness_check',
        trigger: 'case.created',
        humanSignoffRecorded: false,
        idempotencyKey,
      }),
    );

    // Both calls must return the same seq
    expect(first.seq).toBe(second.seq);
    expect(first.eventId).toBe(second.eventId);

    // Exactly ONE CaseStateChanged event must exist
    const eventRows = await tenantQuery(
      `SELECT COUNT(*) AS cnt FROM ens.case_event WHERE case_id = $1 AND event_type = 'CaseStateChanged'`,
      [caseId],
      tenantCtx.tenant_id,
    );
    expect(Number(eventRows.rows[0]!['cnt'])).toBe(1);
  });
});
