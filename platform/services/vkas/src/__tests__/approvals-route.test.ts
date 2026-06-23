import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

/**
 * Builds a test express app whose mocked pool records every SQL call.
 * The approval upsert is the only DML we care about; withTenant plumbing
 * (BEGIN/COMMIT/set_config) is handled transparently.
 */
function buildApp() {
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    sqlCalls.push({ sql, params: params ?? [] });

    // withTenant plumbing
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) || /set_config/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    // approval upsert
    if (/INSERT INTO vkas\.approval/i.test(sql)) {
      return { rows: [], rowCount: 1 };
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

const CANONICAL_URL = 'https://artifacts.simintero.io/shared/model_binding/claude-pa';
const VERSION = '1.1.0';

const VALID_BODY = {
  canonical_url: CANONICAL_URL,
  version: VERSION,
  gate: 'eval',
  approver: 'eval-runner',
  decided: 'approved',
  attestation: {
    outcome_delta: { approve_pct_delta: 0, deny_pct_delta: 0 },
  },
};

describe('POST /v1/approvals', () => {
  it('201 happy path: upserts the approval row and returns summary', async () => {
    const { app, sqlCalls } = buildApp();

    const res = await request(app)
      .post('/v1/approvals')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      canonical_url: CANONICAL_URL,
      version: VERSION,
      gate: 'eval',
      decided: 'approved',
    });

    // Assert that the INSERT … ON CONFLICT upsert was issued with the right params
    const insertCall = sqlCalls.find(
      (c) =>
        /INSERT INTO vkas\.approval/i.test(c.sql) &&
        /ON CONFLICT \(canonical_url, version, gate\)/i.test(c.sql) &&
        /DO UPDATE SET/i.test(c.sql),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall!.params[0]).toBe(CANONICAL_URL);       // $1 canonical_url
    expect(insertCall!.params[1]).toBe(VERSION);             // $2 version
    expect(insertCall!.params[2]).toBe('eval');              // $3 gate
    expect(insertCall!.params[3]).toBe('eval-runner');       // $4 approver
    expect(insertCall!.params[4]).toBe('approved');          // $5 decided
    // $6 = rationale (nullable — can be null/undefined)
    // $7 = attestation JSON string
    const attestationParam = insertCall!.params[6] as string;
    const parsed = JSON.parse(attestationParam);
    expect(parsed).toMatchObject({
      outcome_delta: { approve_pct_delta: 0, deny_pct_delta: 0 },
    });
  });

  it('400 when gate is not in the allowed set', async () => {
    const { app, sqlCalls } = buildApp();

    const res = await request(app)
      .post('/v1/approvals')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ ...VALID_BODY, gate: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');

    // No INSERT must have been issued
    const insertCall = sqlCalls.find((c) => /INSERT INTO vkas\.approval/i.test(c.sql));
    expect(insertCall).toBeUndefined();
  });

  it('400 when decided is not approved or rejected', async () => {
    const { app, sqlCalls } = buildApp();

    const res = await request(app)
      .post('/v1/approvals')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ ...VALID_BODY, decided: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');

    const insertCall = sqlCalls.find((c) => /INSERT INTO vkas\.approval/i.test(c.sql));
    expect(insertCall).toBeUndefined();
  });

  it('400 when canonical_url is missing', async () => {
    const { app, sqlCalls } = buildApp();
    const { canonical_url: _omit, ...bodyWithout } = VALID_BODY;

    const res = await request(app)
      .post('/v1/approvals')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send(bodyWithout);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');

    const insertCall = sqlCalls.find((c) => /INSERT INTO vkas\.approval/i.test(c.sql));
    expect(insertCall).toBeUndefined();
  });
});
