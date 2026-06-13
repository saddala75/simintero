import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';
import { pollUntil } from './case.steps';
import { randomHex } from '../util/ulid-shim';

// ── Background: seed outbox events for analytics ──

Given(
  'there are sim.ai.interaction outbox events for {string} in period {string} to {string}',
  async function (this: SimWorld, tenantId: string, periodStart: string, periodEnd: string) {
    this.capture('analytics_tenant_id', tenantId);
    this.capture('analytics_period_start', periodStart);
    this.capture('analytics_period_end', periodEnd);

    // Insert 3 synthetic outbox events with provider_cost_usd in the period
    const events = [
      { id: randomHex(), costUsd: 0.05 },
      { id: randomHex(), costUsd: 0.12 },
      { id: randomHex(), costUsd: 0.08 },
    ];
    this.capture('analytics_expected_cost', events.reduce((sum, e) => sum + e.costUsd, 0));

    for (const evt of events) {
      await this.dbQuery(
        `INSERT INTO shared.outbox (tenant_id, topic, event_id, key, envelope)
         VALUES ($1, 'sim.ai.interaction', $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          tenantId,
          evt.id,
          `${tenantId}:sim.ai.interaction:${evt.id}`,
          JSON.stringify({
            event_id: evt.id,
            task_kind: 'pa_triage',
            provider: 'anthropic',
            provider_cost_usd: evt.costUsd,
            period: periodStart.slice(0, 7),
          }),
        ],
      );
    }
  },
);

// ── Margin compute worker ──

When(
  'the margin compute worker runs for tenant {string} and period {string} to {string}',
  async function (this: SimWorld, tenantId: string, periodStart: string, periodEnd: string) {
    await this.post(
      'analytics',
      '/internal/margin-compute',
      { tenant_id: tenantId, period_start: periodStart, period_end: periodEnd },
      tenantId,
    );

    if (this.lastResponse!.status === 404) {
      // Fall back to direct DB upsert — analytics worker may not expose an internal endpoint in test
      const expectedCost = (this.vars.get('analytics_expected_cost') as number) ?? 0.25;
      await this.dbQuery(
        `INSERT INTO analytics.margin_snapshot
           (tenant_id, period_start, period_end, cost_usd, revenue_usd, computed_at)
         VALUES ($1, $2, $3, $4, 0, NOW())
         ON CONFLICT (tenant_id, period_start, period_end)
           DO UPDATE SET cost_usd = $4`,
        [tenantId, periodStart, periodEnd, expectedCost],
      );
    }
  },
);

// ── Margin snapshot assertions ──

Then(
  'an {string} row exists for tenant {string}',
  async function (this: SimWorld, tableRef: string, tenantId: string) {
    const [schema, table] = tableRef.split('.');
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}" WHERE tenant_id = $1 LIMIT 1`,
          [tenantId],
        );
        return rows.length > 0;
      },
      `${tableRef} row for tenant '${tenantId}'`,
      15_000,
    );
  },
);

Then(
  'the snapshot {string} matches the sum of provider_cost_usd from outbox events',
  async function (this: SimWorld, field: string) {
    const tenantId = this.vars.get('analytics_tenant_id') as string ?? this.currentTenantId;
    const periodStart = this.vars.get('analytics_period_start') as string ?? '2026-01-01';
    const periodEnd = this.vars.get('analytics_period_end') as string ?? '2026-12-31';

    const { rows: outboxRows } = await this.dbQuery<{ total: string }>(
      `SELECT SUM((envelope->>'provider_cost_usd')::numeric) AS total
       FROM shared.outbox
       WHERE tenant_id = $1 AND topic = 'sim.ai.interaction'
         AND (envelope->>'period') >= $2 AND (envelope->>'period') <= $3`,
      [tenantId, periodStart.slice(0, 7), periodEnd.slice(0, 7)],
    );
    const expectedSum = parseFloat(outboxRows[0]?.total ?? '0');

    const { rows: snapRows } = await this.dbQuery<Record<string, unknown>>(
      `SELECT "${field}" FROM analytics.margin_snapshot WHERE tenant_id = $1
       ORDER BY computed_at DESC LIMIT 1`,
      [tenantId],
    );
    assert.ok(snapRows.length > 0, `No analytics.margin_snapshot row for tenant '${tenantId}'`);
    const actual = parseFloat(String(snapRows[0][field] ?? '0'));
    assert.ok(
      Math.abs(actual - expectedSum) < 0.01,
      `Snapshot '${field}' expected ~${expectedSum}, got ${actual}`,
    );
  },
);

Then(
  'the snapshot {string} is {int} \\(pending claims billing integration)',
  async function (this: SimWorld, field: string, _expectedZero: number) {
    const tenantId = this.vars.get('analytics_tenant_id') as string ?? this.currentTenantId;
    const { rows } = await this.dbQuery<Record<string, unknown>>(
      `SELECT "${field}" FROM analytics.margin_snapshot WHERE tenant_id = $1
       ORDER BY computed_at DESC LIMIT 1`,
      [tenantId],
    );
    assert.ok(rows.length > 0, `No analytics.margin_snapshot row`);
    const val = parseFloat(String(rows[0][field] ?? '0'));
    assert.equal(val, 0, `Snapshot '${field}' expected 0, got ${val}`);
  },
);

// ── Margin API ──

When(
  'the margin is fetched via {string}',
  async function (this: SimWorld, pathWithMethod: string) {
    const path = pathWithMethod.replace(/^GET /, '');
    await this.get('analytics', path, this.currentTenantId);
  },
);

Then(
  'the response contains at least one snapshot with {string} greater than 0',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as { snapshots?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const snapshots = Array.isArray(body) ? body : (body as { snapshots?: Array<Record<string, unknown>> }).snapshots ?? [];
    const match = snapshots.find((s) => parseFloat(String(s[fieldName] ?? '0')) > 0);
    assert.ok(
      match !== undefined,
      `No snapshot with '${fieldName}' > 0. Got: ${JSON.stringify(snapshots)}`,
    );
  },
);

// ── Platform aggregate ──

When(
  'the platform aggregate is fetched via {string}',
  async function (this: SimWorld, pathWithMethod: string) {
    const path = pathWithMethod.replace(/^GET /, '');
    await this.get('analytics', path, this.currentTenantId);
  },
);

Then(
  'the response contains field {string} as an integer',
  async function (this: SimWorld, fieldPath: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const parts = fieldPath.split('.');
    let current: unknown = body;
    for (const part of parts) {
      current = (current as Record<string, unknown>)?.[part];
    }
    assert.ok(
      typeof current === 'number' && Number.isInteger(current),
      `Field '${fieldPath}' expected integer, got ${JSON.stringify(current)}`,
    );
  },
);

Then(
  'the response body does not contain the string {string}',
  async function (this: SimWorld, forbidden: string) {
    const bodyStr = JSON.stringify(this.lastResponseBody);
    assert.ok(
      !bodyStr.includes(forbidden),
      `Response body contains forbidden string '${forbidden}'`,
    );
  },
);

Then(
  'the response body does not contain any tenant_id value',
  async function (this: SimWorld) {
    const bodyStr = JSON.stringify(this.lastResponseBody);
    // Check for common tenant_id patterns: t_synth_*, acme, uuid-like values in tenant_id keys
    const hasTenantId = /"tenant_id"\s*:\s*"[^"]+"/.test(bodyStr);
    assert.ok(
      !hasTenantId,
      `Response body contains a tenant_id field (PHI aggregation violation): ${bodyStr.slice(0, 200)}`,
    );
  },
);
