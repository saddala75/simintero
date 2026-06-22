import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { PgGovernanceStore } from '../store/PgGovernanceStore.js';

const URL = process.env['GOV_TEST_DB_URL'] ?? 'postgres://sim_app:devpassword@localhost:15432/simintero';
const ID = `cr/itest-${Date.now()}`;

describe.skipIf(!process.env['GOV_RUN_INTEGRATION'])('PgGovernanceStore (integration — needs live Postgres)', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: URL }); });
  afterAll(async () => { await pool.end(); });

  it('persists across a fresh pool + emits atomic outbox events', async () => {
    const s1 = new PgGovernanceStore(pool);
    await s1.submit({ artifactId: ID, createdBy: 'author-x', cqlLibraryUrl: `${ID}/cql`, version: '1.0.0' });
    await s1.recordApproval({ artifactId: ID, gate: 'clinical', approver: 'rev-a', decision: 'approved', recordedAt: new Date().toISOString() });

    const pool2 = new pg.Pool({ connectionString: URL });
    const s2 = new PgGovernanceStore(pool2);
    const st = await s2.get(ID);
    expect(st?.approvals.find(a => a.gate === 'clinical')?.decision).toBe('approved');

    await s2.recordApproval({ artifactId: ID, gate: 'compliance', approver: 'rev-b', decision: 'approved', recordedAt: new Date().toISOString() });
    await s2.markActivated(ID);
    expect((await s2.get(ID))?.activated_at).toBeDefined();
    await pool2.end();

    const admin = new pg.Pool({ connectionString: URL.replace('sim_app', 'sim') });
    const ev = await admin.query(
      `SELECT envelope->>'schema_ref' AS sr FROM shared.outbox WHERE key=$1 ORDER BY seq`, [ID]);
    await admin.end();
    const refs = ev.rows.map((r: { sr: string }) => r.sr);
    expect(refs).toContain('sim.artifact/ApprovalRecorded/v1');
    expect(refs).toContain('sim.artifact/Activated/v1');
  });
});
