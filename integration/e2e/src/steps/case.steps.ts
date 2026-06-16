import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';

export async function pollUntil(
  fn: () => Promise<boolean>,
  label: string,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${label}`);
}

Then(
  'the RLS harness passes for tenant {string} on cell {string}',
  async function (this: SimWorld, tenantId: string, _cellId: string) {
    const tables: Array<{ schema: string; table: string; tenant_column: string }> = [
      { schema: 'shared',     table: 'outbox',            tenant_column: 'tenant_id' },
      { schema: 'fabric',     table: 'resource',          tenant_column: 'tenant_id' },
      { schema: 'ens',        table: 'case',              tenant_column: 'tenant_id' },
      { schema: 'ens',        table: 'case_event',        tenant_column: 'tenant_id' },
      { schema: 'docs',       table: 'document',          tenant_column: 'tenant_id' },
      { schema: 'docs',       table: 'redaction_view',    tenant_column: 'tenant_id' },
      { schema: 'revital',    table: 'analysis',          tenant_column: 'tenant_id' },
      { schema: 'revital',    table: 'feedback',          tenant_column: 'tenant_id' },
      { schema: 'qual',       table: 'measure_run',       tenant_column: 'tenant_id' },
      { schema: 'qual',       table: 'measure_report',    tenant_column: 'tenant_id' },
      { schema: 'qual',       table: 'gap',               tenant_column: 'tenant_id' },
      { schema: 'search',     table: 'index_event',       tenant_column: 'tenant_id' },
      { schema: 'search',     table: 'search_log',        tenant_column: 'tenant_id' },
      { schema: 'analytics',  table: 'margin_snapshot',   tenant_column: 'tenant_id' },
      { schema: 'claims',     table: 'claim',             tenant_column: 'tenant_id' },
      { schema: 'claims',     table: 'appeal',            tenant_column: 'tenant_id' },
      { schema: 'automation', table: 'disposition_log',   tenant_column: 'tenant_id' },
      { schema: 'market',     table: 'bundle',            tenant_column: 'tenant_id' },
      { schema: 'market',     table: 'bundle_artifact',   tenant_column: 'tenant_id' },
    ];

    const otherTenant = tenantId === 't_synth_ma' ? 't_synth_medicaid' : 't_synth_ma';
    const failures: string[] = [];

    for (const { schema, table, tenant_column } of tables) {
      const qualified = `"${schema}"."${table}"`;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);
        const { rows } = await client.query(
          `SELECT count(*)::int AS cnt FROM ${qualified} WHERE "${tenant_column}" = $1`,
          [otherTenant],
        );
        const cnt = (rows[0] as { cnt: number }).cnt;
        if (cnt > 0) {
          failures.push(`FAIL: ${qualified}: tenant '${tenantId}' can see ${cnt} rows of '${otherTenant}'`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (!msg.includes('does not exist')) {
          failures.push(`ERROR: ${qualified}: ${msg}`);
        }
      } finally {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        client.release();
      }
    }

    assert.equal(failures.length, 0, `RLS failures:\n${failures.join('\n')}`);
  },
);

Then(
  'the ctrl.tenant table contains a row with tenant_id {string} and status {string}',
  async function (this: SimWorld, tenantId: string, status: string) {
    const { rows } = await this.dbQuery<{ status: string }>(
      `SELECT status FROM ctrl.tenant WHERE tenant_id = $1`,
      [tenantId],
    );
    assert.ok(rows.length > 0, `No ctrl.tenant row for tenant_id '${tenantId}'`);
    assert.equal(rows[0].status, status);
  },
);
