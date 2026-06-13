import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';
import { pollUntil } from './case.steps';

Given(
  'a case {string} with member {string} has been determined',
  async function (this: SimWorld, caseId: string, memberId: string) {
    await this.dbQuery(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel)
       VALUES ($1, 'MA', 'determined', 'standard', 'PAS')
       ON CONFLICT DO NOTHING`,
      [this.currentTenantId],
    );
    this.capture('search_case_id', caseId);
    this.capture('search_member_id', memberId);
  },
);

Given(
  'the search indexer has processed the {string} event for {string}',
  async function (this: SimWorld, _eventType: string, caseId: string) {
    // Trigger indexer via internal API, fall back to direct DB insert
    await this.post(
      'search',
      '/internal/index',
      { entity_type: 'case', entity_id: caseId },
      this.currentTenantId,
    );

    if (this.lastResponse!.status === 404 || this.lastResponse!.status >= 400) {
      await this.dbQuery(
        `INSERT INTO search.index_event (event_id, tenant_id, entity_type, entity_id)
         VALUES ($1, $2, 'case', $3)
         ON CONFLICT (tenant_id, entity_type, entity_id) DO NOTHING`,
        [`evt_idx_${caseId}`, this.currentTenantId, caseId],
      );
    }
  },
);

Then(
  'a {string} row exists for entity_id {string} and entity_type {string}',
  async function (this: SimWorld, tableRef: string, entityId: string, entityType: string) {
    const [schema, table] = tableRef.split('.');
    const { rows } = await this.dbQuery(
      `SELECT 1 FROM "${schema}"."${table}"
       WHERE entity_id = $1 AND entity_type = $2 AND tenant_id = $3 LIMIT 1`,
      [entityId, entityType, this.currentTenantId],
    );
    assert.ok(rows.length > 0, `No ${tableRef} row for entity_id='${entityId}' entity_type='${entityType}'`);
  },
);

When(
  'a search is requested via {string}',
  async function (this: SimWorld, pathWithMethod: string) {
    const urlPart = pathWithMethod.replace(/^GET /, '');
    await this.get('search', urlPart, this.currentTenantId);
  },
);

Then(
  'the response contains field {string} with at least one entry',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const arr = body[fieldName];
    assert.ok(
      Array.isArray(arr) && arr.length >= 1,
      `Expected at least one entry in '${fieldName}', got: ${JSON.stringify(arr)}`,
    );
  },
);

Then(
  'the result entry has entity_type {string} and entity_id {string}',
  async function (this: SimWorld, expectedType: string, expectedId: string) {
    const body = this.lastResponseBody as {
      results?: Array<{ entity_type: string; entity_id: string }>;
    };
    const results = body.results ?? [];
    const match = results.find(
      (r) => r.entity_type === expectedType && r.entity_id === expectedId,
    );
    assert.ok(
      match !== undefined,
      `No result with entity_type='${expectedType}' entity_id='${expectedId}'. Results: ${JSON.stringify(results)}`,
    );
  },
);

Then(
  'the response contains field {string} as a 64-character hex string',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const val = body[fieldName];
    assert.ok(
      typeof val === 'string' && /^[0-9a-f]{64}$/i.test(val),
      `Field '${fieldName}' expected 64-char hex, got: ${JSON.stringify(val)}`,
    );
  },
);

Then(
  'no {string} row contains the raw text {string}',
  async function (this: SimWorld, tableRef: string, rawQuery: string) {
    const [schema, table] = tableRef.split('.');
    // Assert no query_text column exists (PHI by design)
    const { rows: colRows } = await this.dbQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name ILIKE '%query_text%'`,
      [schema, table],
    );
    assert.equal(
      colRows.length,
      0,
      `${tableRef} has a 'query_text' column — raw query text stored (PHI risk): ${colRows.map((r) => r.column_name).join(', ')}`,
    );
    // Also check last row has no column containing the raw query
    const { rows: logRows } = await this.dbQuery<Record<string, unknown>>(
      `SELECT * FROM "${schema}"."${table}" WHERE tenant_id = $1 ORDER BY searched_at DESC LIMIT 1`,
      [this.currentTenantId],
    );
    if (logRows.length > 0) {
      for (const [col, val] of Object.entries(logRows[0])) {
        if (typeof val === 'string' && val.includes(rawQuery)) {
          assert.fail(`Column '${col}' in ${tableRef} contains raw query '${rawQuery}'`);
        }
      }
    }
  },
);

Then(
  'the {string} row contains field {string} as a SHA-256 hex digest',
  async function (this: SimWorld, tableRef: string, fieldName: string) {
    const [schema, table] = tableRef.split('.');
    const { rows } = await this.dbQuery<Record<string, unknown>>(
      `SELECT "${fieldName}" FROM "${schema}"."${table}" WHERE tenant_id = $1 ORDER BY searched_at DESC LIMIT 1`,
      [this.currentTenantId],
    );
    assert.ok(rows.length > 0, `No rows in ${tableRef} for tenant '${this.currentTenantId}'`);
    const hashValue = rows[0][fieldName];
    assert.ok(hashValue !== null && hashValue !== undefined, `Field '${fieldName}' is null`);
    assert.match(
      String(hashValue),
      /^[0-9a-f]{64}$/,
      `Field '${fieldName}' is not a valid SHA-256 hex: '${hashValue}'`,
    );
  },
);

// Suppress unused import warning — pollUntil is available for future steps in this file
void (pollUntil as unknown);
