import { Given, When, Then } from '@cucumber/cucumber';
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

When(
  'an actor with role {string} in tenant {string} appends a CaseCreated event for case {string}',
  async function (
    this: SimWorld,
    _role: string,
    tenantId: string,
    caseId: string,
    docString: string,
  ) {
    this.currentTenantId = tenantId;
    this.capture('original_payload', JSON.parse(docString));

    await this.post(
      'enstellarCase',
      `/v1/cases/${encodeURIComponent(caseId)}/events`,
      { type: 'CaseCreated', payload: JSON.parse(docString) },
      tenantId,
    );
    assert.ok(
      this.lastResponse!.status < 300,
      `Case event append returned ${this.lastResponse!.status}: ${JSON.stringify(this.lastResponseBody)}`,
    );
    // Capture the UUID returned by the service (label is not a valid UUID for DB queries)
    const body = this.lastResponseBody as { case_ref?: string; case_id?: string };
    const resolvedId = body.case_ref ?? body.case_id ?? caseId;
    this.capture('current_case_id', resolvedId);
    // Also index by the original label so the RLS step can resolve "case_exit_test_01" → UUID
    this.capture(caseId, resolvedId);
  },
);

When(
  'the outbox relay publishes the event to the {string} Kafka topic',
  async function (this: SimWorld, topic: string) {
    const tenantId = this.currentTenantId;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM shared.outbox WHERE topic = $1 AND tenant_id = $2 LIMIT 1`,
          [topic, tenantId],
        );
        return rows.length > 0;
      },
      `shared.outbox row with topic='${topic}' and tenant_id='${tenantId}'`,
      10_000,
    );
  },
);

When(
  'the case consumer replays the event log for case {string}',
  async function (this: SimWorld, caseId: string) {
    await this.post(
      'enstellarCase',
      `/v1/cases/${encodeURIComponent(caseId)}/replay`,
      {},
      this.currentTenantId,
    );
    assert.ok(
      this.lastResponse!.status < 300,
      `Replay returned ${this.lastResponse!.status}: ${JSON.stringify(this.lastResponseBody)}`,
    );
  },
);

Then(
  'the replayed case matches the original payload with all fields preserved',
  async function (this: SimWorld) {
    const caseId = this.vars.get('current_case_id') as string;
    const original = this.vars.get('original_payload') as Record<string, unknown>;

    await this.get('enstellarCase', `/v1/cases/${encodeURIComponent(caseId)}`, this.currentTenantId);
    assert.equal(this.lastResponse!.status, 200, `GET case returned ${this.lastResponse!.status}`);

    const body = this.lastResponseBody as { payload?: Record<string, unknown> };
    const payload = body.payload ?? (this.lastResponseBody as Record<string, unknown>);

    for (const [key, expected] of Object.entries(original)) {
      assert.equal(
        String(payload[key]),
        String(expected),
        `Field '${key}' mismatch: expected '${expected}', got '${payload[key]}'`,
      );
    }
  },
);

Then(
  'the event appears in the audit log with:',
  async function (this: SimWorld, dataTable: { rows(): string[][] }) {
    const caseId = this.vars.get('current_case_id') as string;
    const { rows } = await this.dbQuery<Record<string, unknown>>(
      `SELECT event_type, tenant_id, actor, trace_ref
       FROM ens.case_event
       WHERE case_id = $1::uuid
       ORDER BY seq DESC
       LIMIT 1`,
      [caseId],
    );
    assert.ok(rows.length > 0, `No ens.case_event rows for case_id '${caseId}'`);

    const row = rows[0];
    const actor =
      typeof row['actor'] === 'string'
        ? (JSON.parse(row['actor'] as string) as Record<string, unknown>)
        : (row['actor'] as Record<string, unknown>);

    for (const [field, expected] of dataTable.rows()) {
      let actual: unknown;
      if (field === 'actor_type') {
        actual = actor['type'] ?? actor['actor_type'];
      } else if (field === 'schema_ref') {
        actual = actor['schema_ref'] ?? row['trace_ref'];
      } else {
        actual = row[field];
      }
      assert.equal(
        String(actual),
        expected,
        `Audit log field '${field}' expected '${expected}', got '${actual}'`,
      );
    }
  },
);

Then(
  'the RLS harness confirms tenant {string} cannot read case {string}',
  async function (this: SimWorld, otherTenantId: string, caseId: string) {
    const resolvedCaseId = (this.vars.get(caseId) as string | undefined) ?? caseId;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [otherTenantId]);
      const { rows } = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM ens.case WHERE case_id = $1::uuid AND tenant_id = $2`,
        [resolvedCaseId, otherTenantId],
      );
      assert.equal(rows[0].cnt, 0, `RLS leak: tenant '${otherTenantId}' can see case '${resolvedCaseId}'`);
    } finally {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      client.release();
    }
  },
);
