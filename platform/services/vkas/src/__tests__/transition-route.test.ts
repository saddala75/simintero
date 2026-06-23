import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

function appWith(statusRow: string | null) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/SELECT status/i.test(sql)) {
      return { rows: statusRow ? [{ status: statusRow }] : [] };
    }
    return { rowCount: 1 }; // UPDATE / BEGIN / COMMIT / set_config
  });
  const client = { query, release: vi.fn() };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = { connect: vi.fn(async () => client) };
  app.use(createVkasRouter());
  return { app, query, calls };
}

describe('POST /v1/artifacts/submit', () => {
  it('draft → in_review', async () => {
    const { app, calls } = appWith('draft');
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='in_review'/i.test(s))).toBe(true);
  });

  it('invalid transition (active → in_review) → 422', async () => {
    const { app } = appWith('active');
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(422);
  });

  it('404 when not found', async () => {
    const { app } = appWith(null);
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/artifacts/activate', () => {
  it('in_review → active (folds approved)', async () => {
    const { app, calls } = appWith('in_review');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });

  it('approved → active', async () => {
    const { app } = appWith('approved');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
  });

  it('draft → active is invalid → 422', async () => {
    const { app } = appWith('draft');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(422);
  });

  it('activating v2 demotes the prior active v1 to superseded', async () => {
    // v2 is in_review (the version being activated); the pool also handles the
    // demotion UPDATE for any prior active version (returns rowCount: 1).
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/SELECT status/i.test(sql)) {
        return { rows: [{ status: 'in_review' }] };
      }
      // demotion UPDATE or activation UPDATE — both succeed
      return { rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const app = express();
    app.use(express.json());
    app.locals['pool'] = { connect: vi.fn(async () => client) };
    app.use(createVkasRouter());

    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'policy://pa-criteria/v1', version: '2.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // The handler must have issued a demotion UPDATE for the prior active version
    expect(
      calls.some((s) => /UPDATE vkas\.artifact SET status='superseded'/i.test(s))
    ).toBe(true);
    // The demotion must scope to the same canonical_url but a DIFFERENT version
    expect(
      calls.some(
        (s) =>
          /status='superseded'/i.test(s) &&
          /status='active'/i.test(s) &&
          /version <>/i.test(s),
      )
    ).toBe(true);
  });

  it('first-time activation (no prior active) issues no demotion error', async () => {
    // When rowCount=0 from the demotion UPDATE it simply means no prior active existed;
    // the handler must still succeed and NOT issue a 422/500.
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/SELECT status/i.test(sql)) {
        return { rows: [{ status: 'approved' }] };
      }
      if (/status='superseded'/i.test(sql)) {
        return { rowCount: 0 }; // no prior active existed
      }
      return { rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const app = express();
    app.use(express.json());
    app.locals['pool'] = { connect: vi.fn(async () => client) };
    app.use(createVkasRouter());

    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'policy://pa-criteria/v1', version: '1.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // activation UPDATE must still be issued
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });
});

// ── Eval gate tests (slice 2.2b Task 3) ────────────────────────────────────
// Helper: build an app whose pool mock returns the given artifact_type + status,
// and for the eval-approval SELECT returns the supplied approval row (or none).
function appWithEvalGate(opts: {
  artifactType: string;
  status: string;
  evalDecided: string | null; // null = no approval row
  attestation?: Record<string, unknown> | null; // eval approval attestation (outcome_delta etc.)
}) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    // artifact load (currentStatus — now returns status + artifact_type)
    if (/SELECT status.*artifact_type/i.test(sql) || /SELECT.*artifact_type.*status/i.test(sql)) {
      return { rows: [{ status: opts.status, artifact_type: opts.artifactType }] };
    }
    // eval approval lookup
    if (/SELECT decided.*FROM vkas\.approval/i.test(sql) && /gate='eval'/i.test(sql)) {
      if (opts.evalDecided === null) return { rows: [] };
      return { rows: [{ decided: opts.evalDecided, attestation: opts.attestation ?? null }] };
    }
    // UPDATE superseded / UPDATE active / set_config / BEGIN / COMMIT
    return { rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = { connect: vi.fn(async () => client) };
  app.use(createVkasRouter());
  return { app, calls };
}

describe('POST /v1/artifacts/activate — eval gate (slice 2.2b Task 3)', () => {
  it('model_binding with NO eval approval row → 409 SIM-VKAS-EVAL_REQUIRED', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: null,
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SIM-VKAS-EVAL_REQUIRED');
    // No status UPDATE must have been issued
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(false);
  });

  it('model_binding with rejected eval approval → 409 SIM-VKAS-EVAL_REQUIRED', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'approved',
      evalDecided: 'rejected',
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SIM-VKAS-EVAL_REQUIRED');
    // No status UPDATE must have been issued
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(false);
  });

  it('model_binding with approved eval approval → 200 (proceeds to activate)', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // The activate UPDATE must have been issued
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });

  it('coverage_rule (non-AI) activates without any eval approval lookup → 200', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'coverage_rule',
      status: 'in_review',
      evalDecided: null, // no approval row — but it should NOT be needed
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/coverage_rule/pa-policy', version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // The eval approval SELECT must NOT have been issued
    expect(
      calls.some((s) => /SELECT decided.*FROM vkas\.approval/i.test(s) && /gate='eval'/i.test(s))
    ).toBe(false);
  });
});

describe('POST /v1/artifacts/activate — blast-radius gate (slice 2.2b I-1)', () => {
  it('approved eval with outcome_delta {0,0} → 200 (delta passes, activates)', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
      attestation: { outcome_delta: { approve_pct_delta: 0, deny_pct_delta: 0 } },
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });

  it('approved eval with NO attestation → 200 (missing delta passes — CI mock case)', async () => {
    const { app } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
      attestation: null,
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('approved eval whose approve_pct_delta exceeds 0.10 → 422 SIM-VKAS-BLAST_RADIUS (no activate)', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
      attestation: { outcome_delta: { approve_pct_delta: 0.25, deny_pct_delta: 0 } },
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-VKAS-BLAST_RADIUS');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(false);
  });

  it('approved eval whose deny_pct_delta exceeds 0.05 → 422 SIM-VKAS-BLAST_RADIUS', async () => {
    const { app, calls } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
      attestation: { outcome_delta: { approve_pct_delta: 0, deny_pct_delta: 0.06 } },
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-VKAS-BLAST_RADIUS');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(false);
  });

  it('negative delta beyond threshold (abs) also blocks → 422', async () => {
    const { app } = appWithEvalGate({
      artifactType: 'model_binding',
      status: 'in_review',
      evalDecided: 'approved',
      attestation: { outcome_delta: { approve_pct_delta: -0.2, deny_pct_delta: 0 } },
    });
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa', version: '1.1.0' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SIM-VKAS-BLAST_RADIUS');
  });
});
