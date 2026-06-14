import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import app, { setDb } from '../server.js';
import type { TenantDb, DbClient } from '@sim/outbox-ts';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://sim:sim@localhost:5432/simintero';
const TENANT = 'tenant-notify-test';

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

// Seeds a fresh case in 'intake' state, returns its UUID
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

describe('POST /internal/transitions/notify', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    setDb(makeTenantDb(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  function makeEnvelope(caseId: string, payloadOverride?: Record<string, unknown>, topOverride?: Record<string, unknown>) {
    return {
      event_id: crypto.randomUUID(),
      schema_ref: 'sim.case.lifecycle/CaseStateChanged/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: TENANT },
      correlation_id: `case_${caseId}`,
      causation_id: null,
      actor: { type: 'service', id: 'enstellar-workflow' },
      trace_ref: null,
      payload: {
        case_id: caseId,
        from: 'intake',
        to: 'completeness_check',
        trigger: 'case.created',
        ...payloadOverride,
      },
      ...topOverride,
    };
  }

  it('200 — accepts valid transition', async () => {
    const caseId = await seedCase(pool);
    const res = await request(app)
      .post('/internal/transitions/notify')
      .set('x-sim-tenant-id', TENANT)
      .send(makeEnvelope(caseId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('event_id');
    expect(res.body).toHaveProperty('seq');
    expect(typeof res.body['seq']).toBe('number');
  });

  it('400 — missing required payload fields', async () => {
    const res = await request(app)
      .post('/internal/transitions/notify')
      .set('x-sim-tenant-id', TENANT)
      .send({ schema_ref: 'sim.case.lifecycle/CaseStateChanged/v1' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('403 — adverse transition without human signoff', async () => {
    const caseId = await seedCase(pool);
    const res = await request(app)
      .post('/internal/transitions/notify')
      .set('x-sim-tenant-id', TENANT)
      .send(makeEnvelope(caseId, {
        case_id: caseId,
        from: 'clinical_review',
        to: 'denied',
        trigger: 'decision.recorded',
        human_signoff_recorded: false,
      }));
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('SIM-GUARD-0001');
  });

  it('200 — idempotent on repeated event_id', async () => {
    const caseId = await seedCase(pool);
    const fixedEventId = crypto.randomUUID();
    const envelope = makeEnvelope(
      caseId,
      { case_id: caseId, from: 'intake', to: 'completeness_check', trigger: 'case.created' },
      { event_id: fixedEventId },
    );

    const res1 = await request(app)
      .post('/internal/transitions/notify')
      .set('x-sim-tenant-id', TENANT)
      .send(envelope);

    const res2 = await request(app)
      .post('/internal/transitions/notify')
      .set('x-sim-tenant-id', TENANT)
      .send(envelope);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body['seq']).toBe(res1.body['seq']);
    expect(res2.body['event_id']).toBe(res1.body['event_id']);
  });
});
