import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildDispositionsRouter } from '../routes/dispositions.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}
function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildDispositionsRouter(pool));
  return app;
}

afterEach(() => vi.restoreAllMocks());

const validBody = {
  case_ref: '01HXYZ123',
  proposed_outcome: 'approve',
  confidence: 0.95,
  classification: 'routine',
  analysis_id: '01HABC456',
};

describe('POST / dispositions', () => {
  it('401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-user-id', 'system-agent-1')
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Missing x-sim-tenant-id header' });
  });

  it('401 when x-sim-user-id header is missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Missing x-sim-user-id header' });
  });

  it('422 SIM-AUTO-ADVERSE_BLOCKED when proposed_outcome is deny', async () => {
    const pool = makePool([{ rows: [] }]);
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .set('x-sim-user-id', 'system-agent-1')
      .send({ ...validBody, proposed_outcome: 'deny' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-AUTO-ADVERSE_BLOCKED');
    expect(res.body.deny_reasons).toContain('adverse_outcome_blocked');
  });

  it('422 SIM-AUTO-ADVERSE_BLOCKED when proposed_outcome is modify', async () => {
    const pool = makePool([{ rows: [] }]);
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .set('x-sim-user-id', 'system-agent-1')
      .send({ ...validBody, proposed_outcome: 'modify' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-AUTO-ADVERSE_BLOCKED');
  });

  it('422 SIM-AUTO-GATE_BLOCKED when OPA gate returns allow=false', async () => {
    // Pool: first call is entitlement lookup for OPA input
    const pool = makePool([{ rows: [] }, { rows: [] }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: { allow: false, deny_reasons: ['automation_not_enabled'] } }),
    }));
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .set('x-sim-user-id', 'system-agent-1')
      .send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-AUTO-GATE_BLOCKED');
    expect(res.body.deny_reasons).toContain('automation_not_enabled');
  });

  it('200 with status=dry_run when entitlement absent and OPA allows', async () => {
    // Pool call ordering:
    // Call 0: ctrl.entitlement (for OPA input build) → rows: [] → live = false
    // Call 1: ctrl.entitlement (for dry_run determination) → rows: [] → dry_run = true
    // Call 2: shared.outbox INSERT
    // Call 3: automation.disposition_log INSERT
    const pool = makePool([
      { rows: [] }, // entitlement for OPA
      { rows: [] }, // entitlement for dry_run
      { rows: [] }, // outbox insert
      { rows: [] }, // disposition_log insert
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: { allow: true, deny_reasons: [] } }),
    }));
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .set('x-sim-user-id', 'system-agent-1')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dry_run');
    expect(res.body.case_ref).toBe(validBody.case_ref);

    // Verify UPDATE ens.case was NOT called
    const allCalls: string[] = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => String(args[0]),
    );
    const hadCaseUpdate = allCalls.some((sql) => sql.includes('UPDATE ens.case'));
    expect(hadCaseUpdate).toBe(false);
  });

  it('400 when required fields are missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);
    const res = await supertest(app)
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .set('x-sim-user-id', 'system-agent-1')
      .send({ case_ref: '01HXYZ123' }); // missing proposed_outcome, confidence, classification, analysis_id
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Missing required fields' });
  });
});
