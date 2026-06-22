import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

/**
 * Builds a test express app with a mocked pool that simulates the exact query
 * sequence `rollbackArtifact` issues:
 *   1. SELECT target (WHERE canonical_url=$1 AND version=$2)
 *   2. SELECT superseded prior (WHERE … status='superseded' …)
 *   3. UPDATE target → rolled_back
 *   4. UPDATE prior  → active
 *   5. INSERT INTO shared.outbox  (×2 — ArtifactRolledBack then ArtifactActivated)
 *   6. SELECT target again (re-read for rolledBack in response)
 *   7. SELECT prior again  (re-read for restored in response)
 */
function buildApp(opts: {
  targetRow: Record<string, unknown> | null;
  priorRow: Record<string, unknown> | null;
}) {
  const { targetRow, priorRow } = opts;

  // Track query calls so tests can assert on them.
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];

  // Mutable store so post-UPDATE re-reads reflect the new status.
  const store: Record<string, Record<string, unknown>> = {};
  if (targetRow) store[targetRow['version'] as string] = { ...targetRow };
  if (priorRow) store[priorRow['version'] as string] = { ...priorRow };

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    sqlCalls.push({ sql, params: params ?? [] });

    // withTenant plumbing: BEGIN / set_config / COMMIT
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) || /set_config/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    // outbox inserts
    if (/INSERT INTO shared\.outbox/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    // UPDATE target → rolled_back
    if (/UPDATE vkas\.artifact SET status='rolled_back'/i.test(sql)) {
      const v = params?.[1] as string;
      if (store[v]) store[v]['status'] = 'rolled_back';
      return { rows: [], rowCount: 1 };
    }
    // UPDATE prior → active
    if (/UPDATE vkas\.artifact SET status='active'/i.test(sql)) {
      const v = params?.[1] as string;
      if (store[v]) store[v]['status'] = 'active';
      return { rows: [], rowCount: 1 };
    }
    // SELECT superseded prior
    if (/status='superseded'/i.test(sql)) {
      return priorRow
        ? { rows: [priorRow], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    // SELECT target or post-update re-reads (WHERE canonical_url=$1 AND version=$2)
    if (/WHERE canonical_url=\$1 AND version=\$2/i.test(sql)) {
      const v = params?.[1] as string;
      if (store[v]) return { rows: [store[v]], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  });

  const client = { query, release: vi.fn() };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = { connect: vi.fn(async () => client) };
  app.use(createVkasRouter());

  return { app, sqlCalls };
}

// The canonical URL used in tests (contains slashes — needs encoding in the path)
const CANONICAL_URL = 'https://artifacts.simintero.io/shared/coverage_rule/29828';
const ENCODED_URL = encodeURIComponent(CANONICAL_URL);
const VERSION = '2.0.0';

const TARGET_ROW: Record<string, unknown> = {
  canonical_url: CANONICAL_URL,
  version: '2.0.0',
  status: 'active',
  artifact_type: 'coverage_criteria',
  created_at: '2025-01-01T00:00:00Z',
  effective_from: '2025-01-01',
  effective_to: null,
};

const PRIOR_ROW: Record<string, unknown> = {
  canonical_url: CANONICAL_URL,
  version: '1.0.0',
  status: 'superseded',
  artifact_type: 'coverage_criteria',
  created_at: '2024-01-01T00:00:00Z',
  effective_from: '2024-01-01',
  effective_to: null,
};

describe('POST /v1/artifacts/:canonical_url/:version/rollback', () => {
  it('200 happy path: returns rolled_back + restored when target active and superseded prior exists', async () => {
    const { app } = buildApp({ targetRow: TARGET_ROW, priorRow: PRIOR_ROW });

    const res = await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ reason: 'bad rule deployment' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rolled_back');
    expect(res.body).toHaveProperty('restored');
    expect(res.body.rolled_back.version).toBe('2.0.0');
    expect(res.body.restored.version).toBe('1.0.0');
  });

  it('400 when reason is missing from the body', async () => {
    const { app } = buildApp({ targetRow: TARGET_ROW, priorRow: PRIOR_ROW });

    const res = await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('404 when the target artifact does not exist', async () => {
    const { app } = buildApp({ targetRow: null, priorRow: null });

    const res = await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ reason: 'test' });

    expect(res.status).toBe(404);
  });

  it('409 when target exists but is not in active status', async () => {
    const { app } = buildApp({
      targetRow: { ...TARGET_ROW, status: 'draft' },
      priorRow: PRIOR_ROW,
    });

    const res = await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ reason: 'test' });

    expect(res.status).toBe(409);
  });

  it('409 when target is active but no superseded prior exists', async () => {
    const { app } = buildApp({ targetRow: TARGET_ROW, priorRow: null });

    const res = await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ reason: 'test' });

    expect(res.status).toBe(409);
  });

  it('decodes the canonical_url param so the SELECT receives the unencoded URL', async () => {
    const { app, sqlCalls } = buildApp({ targetRow: TARGET_ROW, priorRow: PRIOR_ROW });

    await request(app)
      .post(`/v1/artifacts/${ENCODED_URL}/${VERSION}/rollback`)
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ reason: 'decode-check' });

    // The first SELECT must carry the DECODED url as a query parameter, not the
    // percent-encoded form.
    const targetSelects = sqlCalls.filter(
      (c) => /WHERE canonical_url=\$1 AND version=\$2/i.test(c.sql),
    );
    expect(targetSelects.length).toBeGreaterThan(0);
    // Every such SELECT must pass the decoded URL, never the encoded one.
    for (const call of targetSelects) {
      expect(call.params?.[0]).toBe(CANONICAL_URL);
      expect(call.params?.[0]).not.toBe(ENCODED_URL);
    }
  });
});
