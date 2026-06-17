import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createAnalysesRouter } from '../routes/analyses.js';

function makePool(rows: unknown[] = []): Pool {
  const client = { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() };
  return {
    query: vi.fn().mockResolvedValue({ rows }),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

const VALID_BODY = {
  case_ref: 'case_1',
  analysis_kinds: ['summary', 'triage'],
  inputs: { document_refs: ['d1'], case_context: { lob: 'MA', urgency: 'standard', service_lines: [] } },
};

describe('POST /v1/assist/analyses', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(createAnalysesRouter(makePool(), { start: vi.fn().mockResolvedValue({ workflowId: 'wf_1' }) } as never));
  });

  it('returns 202 with analysis_id for a valid request', async () => {
    const res = await request(app)
      .post('/v1/assist/analyses')
      .set('x-sim-tenant-id', 't_test')
      .send(VALID_BODY);

    expect(res.status).toBe(202);
    expect(res.body.analysis_id).toBeTruthy();
    expect(res.body.operation).toContain('operations/');
  });

  it('returns 409 when ai.inference.disabled is set', async () => {
    const pool = makePool([{ key: 'ai.inference.disabled', value: { value: true } }]);
    const killApp = express();
    killApp.use(express.json());
    killApp.use(createAnalysesRouter(pool, { start: vi.fn() } as never));

    const res = await request(killApp)
      .post('/v1/assist/analyses')
      .set('x-sim-tenant-id', 't_test')
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SIM-REV-DISABLED');
  });

  it('returns 401 when x-sim-tenant-id is missing', async () => {
    const res = await request(app)
      .post('/v1/assist/analyses')
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it('starts the workflow on taskQueue=revital with the registered name + tenant_id', async () => {
    const startSpy = vi.fn().mockResolvedValue({ workflowId: 'wf_1' });
    const app2 = express();
    app2.use(express.json());
    app2.use(createAnalysesRouter(makePool(), { start: startSpy } as never));
    await request(app2).post('/v1/assist/analyses').set('x-sim-tenant-id', 't_test').send(VALID_BODY);
    expect(startSpy).toHaveBeenCalledOnce();
    const [wfName, opts] = startSpy.mock.calls[0]!;
    expect(wfName).toBe('revitalAnalyzeCase');
    expect((opts as { taskQueue: string }).taskQueue).toBe('revital');
    expect((opts as { args: Array<{ tenant_id: string }> }).args[0]!.tenant_id).toBe('t_test');
  });
});

describe('GET /v1/assist/analyses/:id', () => {
  it('returns 200 with classification=advisory for existing analysis', async () => {
    const pool = makePool([{
      analysis_id: 'ana_1', status: 'complete', case_ref: 'case_1',
      interaction: {}, summary: null, extraction: null, completeness: null, triage: null,
      abstentions: [], unprocessed_inputs: [],
    }]);
    const app = express();
    app.use(express.json());
    app.use(createAnalysesRouter(pool, {} as never));

    const res = await request(app)
      .get('/v1/assist/analyses/ana_1')
      .set('x-sim-tenant-id', 't_test');

    expect(res.status).toBe(200);
    expect(res.body.classification).toBe('advisory');  // INV-1
    expect(res.body.analysis_id).toBe('ana_1');
  });

  it('returns 404 when analysis does not exist', async () => {
    const app = express();
    app.use(express.json());
    app.use(createAnalysesRouter(makePool([]), {} as never));

    const res = await request(app)
      .get('/v1/assist/analyses/missing')
      .set('x-sim-tenant-id', 't_test');

    expect(res.status).toBe(404);
  });
});
