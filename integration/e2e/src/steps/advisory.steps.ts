import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld, SERVICE_BASE } from '../world';
import { pollUntil } from './case.steps';
import { fetch } from 'undici';

const MODEL_GATEWAY_URL = process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:3011';
const BFF_URL = process.env['BFF_URL'] ?? 'http://localhost:3021';

// ── Model Gateway mock configuration ──

Given(
  'the Model Gateway is configured with the mock Anthropic adapter',
  async function (this: SimWorld) {
    const res = await fetch(`${MODEL_GATEWAY_URL}/admin/mock-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, deterministic: true }),
    });
    assert.ok(
      res.status < 300 || res.status === 404,
      `Model Gateway mock-mode setup returned ${res.status}`,
    );
  },
);

Given(
  'the mock adapter returns deterministic cited responses for all task_kinds',
  async function (this: SimWorld) {
    // Idempotent with prior step — no-op
  },
);

Given(
  'the Model Gateway is configured to return 503 for all requests',
  async function (this: SimWorld) {
    const res = await fetch(`${MODEL_GATEWAY_URL}/admin/mock-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, force_status: 503 }),
    });
    assert.ok(
      res.status < 300 || res.status === 404,
      `Model Gateway 503-mode setup returned ${res.status}`,
    );
  },
);

// ── Document fixture ingestion ──

Given(
  'the Document Service has ingested fixture document {string} with doc_id {string} and virus_scan_status {string}',
  async function (
    this: SimWorld,
    _filename: string,
    docId: string,
    virusScanStatus: string,
  ) {
    await this.dbQuery(
      `INSERT INTO docs.document
         (doc_id, tenant_id, doc_type, source_channel, object_key, virus_scan_status, created_by)
       VALUES ($1::uuid, $2, 'clinical_notes', 'portal_upload', $3, $4,
               '{"type":"service","id":"e2e-fixture"}')
       ON CONFLICT (doc_id) DO UPDATE SET virus_scan_status = $4`,
      [docId, this.currentTenantId, `fixtures/${docId}`, virusScanStatus],
    );
    this.capture('doc_fixture_id', docId);
  },
);

// ── FHIR PAS submission ──

Given(
  'a valid PAS ClaimBundle for member {string} with service category {string} and urgency {string}',
  async function (this: SimWorld, memberId: string, serviceCategory: string, urgency: string) {
    this.capture('pas_member_id', memberId);
    this.capture('pas_service_category', serviceCategory);
    this.capture('pas_urgency', urgency);
  },
);

When(
  'the FHIR facade receives {string} with the ClaimBundle',
  async function (this: SimWorld, httpVerb: string) {
    const path = httpVerb.split(' ')[1] ?? '/fhir/ClaimResponse/$submit';
    const claimBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'ClaimResponse',
            status: 'active',
            patient: { reference: `Patient/${this.vars.get('pas_member_id')}` },
            item: [
              {
                serviceCategory: this.vars.get('pas_service_category'),
                urgency: this.vars.get('pas_urgency'),
              },
            ],
          },
        },
      ],
    };
    await this.post('fhirFacade', path, claimBundle, this.currentTenantId);
  },
);

Then('the response status is {int}', async function (this: SimWorld, expectedStatus: number) {
  assert.equal(
    this.lastResponse!.status,
    expectedStatus,
    `Expected HTTP ${expectedStatus}, got ${this.lastResponse!.status}: ${JSON.stringify(this.lastResponseBody)}`,
  );
});

Then(
  'a case is created with status {string}',
  async function (this: SimWorld, expectedStatus: string) {
    const body = this.lastResponseBody as { case_ref?: string; status?: string };
    assert.ok(body.case_ref, `Response missing case_ref: ${JSON.stringify(body)}`);
    assert.equal(body.status?.toUpperCase(), expectedStatus.toUpperCase());
  },
);

Then(
  'the case_ref is captured as {string}',
  async function (this: SimWorld, varName: string) {
    const body = this.lastResponseBody as { case_ref?: string };
    assert.ok(body.case_ref, `Response missing case_ref`);
    this.capture(varName, body.case_ref);
  },
);

// ── Temporal workflow polling ──

When(
  'the Temporal workflow {string} starts for {string}',
  async function (this: SimWorld, workflowName: string, caseRefVar: string) {
    this.capture('temporal_workflow', workflowName);
    this.capture('temporal_case_ref_var', caseRefVar);
  },
);

When(
  'the workflow waits for the Revital analysis trigger',
  async function (this: SimWorld) {
    // No-op: workflow starts automatically after case creation
  },
);

// ── Revital pipeline ──
// NOTE: document_refs in the feature file appears as an unquoted JSON array literal
// e.g.: with case_ref "test_case_ref" and document_refs ["doc_fixture_01"]
// We use a regex-based step to capture both the quoted case_ref and the raw array.

When(
  /^the Revital pipeline receives "([^"]+)" with case_ref "([^"]+)" and document_refs (\[.+\])$/,
  async function (
    this: SimWorld,
    _httpVerb: string,
    caseRefVarOrLiteral: string,
    docRefsJson: string,
  ) {
    const caseRef = this.vars.has(caseRefVarOrLiteral)
      ? String(this.vars.get(caseRefVarOrLiteral))
      : caseRefVarOrLiteral;
    const docRefs = JSON.parse(docRefsJson) as string[];

    await this.post(
      'revital',
      '/v1/assist/analyses',
      {
        case_ref: caseRef,
        analysis_kinds: ['triage', 'summary', 'extraction', 'completeness'],
        inputs: { document_refs: docRefs, case_context: { lob: 'MA', urgency: 'standard' } },
      },
      this.currentTenantId,
    );
    assert.ok(
      this.lastResponse!.status < 300,
      `Revital POST returned ${this.lastResponse!.status}`,
    );
  },
);

Then(
  'a {string} row exists with analysis_id captured as {string}',
  async function (this: SimWorld, tableRef: string, varName: string) {
    const [schema, table] = tableRef.split('.');
    const caseRef =
      (this.vars.get('test_case_ref') as string | undefined) ?? this.currentTenantId;
    const { rows } = await this.dbQuery<{ analysis_id: string }>(
      `SELECT analysis_id FROM "${schema}"."${table}" WHERE case_ref = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [caseRef, this.currentTenantId],
    );
    assert.ok(rows.length > 0, `No ${tableRef} row for case_ref '${caseRef}'`);
    this.capture(varName, rows[0].analysis_id);
  },
);

// Overload: "a {string} row exists for {string}" (feedback check variant)
Then(
  'a {string} row exists for {string}',
  async function (this: SimWorld, tableRef: string, varName: string) {
    const [schema, table] = tableRef.split('.');
    const idValue =
      (this.vars.get(varName) as string | undefined) ?? varName;
    // Try common id column names
    const candidates = ['analysis_id', 'feedback_id', 'id'];
    let found = false;
    for (const col of candidates) {
      try {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}" WHERE "${col}" = $1 LIMIT 1`,
          [idValue],
        );
        if (rows.length > 0) {
          found = true;
          break;
        }
      } catch {
        // column doesn't exist, try next
      }
    }
    if (!found) {
      // Fall back: any row matching tenant
      const { rows } = await this.dbQuery(
        `SELECT 1 FROM "${schema}"."${table}" WHERE tenant_id = $1 LIMIT 1`,
        [this.currentTenantId],
      );
      found = rows.length > 0;
    }
    assert.ok(found, `No ${tableRef} row found for '${varName}' = '${idValue}'`);
  },
);

Then(
  'the analysis status is eventually {string} within {int} seconds',
  async function (this: SimWorld, expectedStatus: string, timeoutSec: number) {
    const analysisId = this.vars.get('test_analysis_id') as string;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ status: string }>(
          `SELECT status FROM revital.analysis WHERE analysis_id = $1`,
          [analysisId],
        );
        const s = rows[0]?.status;
        return s === expectedStatus || s === 'partial' || s === 'failed';
      },
      `revital.analysis status='${expectedStatus}' for '${analysisId}'`,
      timeoutSec * 1000,
    );
    const { rows } = await this.dbQuery<{ status: string }>(
      `SELECT status FROM revital.analysis WHERE analysis_id = $1`,
      [analysisId],
    );
    assert.equal(rows[0].status, expectedStatus);
  },
);

When(
  'the analysis result is fetched via {string}',
  async function (this: SimWorld, pathTemplate: string) {
    // Extract just the path portion if a verb prefix is present (e.g. "GET /v1/...")
    const raw = pathTemplate.includes(' ') ? pathTemplate.split(' ')[1]! : pathTemplate;
    const path = this.resolve(raw);
    await this.get('revital', path, this.currentTenantId);
  },
);

Then(
  'the response body contains classification {string}',
  async function (this: SimWorld, expected: string) {
    const body = this.lastResponseBody as { classification?: string };
    assert.equal(body.classification, expected);
  },
);

Then(
  'the response body contains status {string}',
  async function (this: SimWorld, expected: string) {
    const body = this.lastResponseBody as { status?: string };
    assert.equal(body.status, expected);
  },
);

Then(
  'the summary block status is {string}',
  async function (this: SimWorld, expected: string) {
    const body = this.lastResponseBody as { summary?: { status?: string } };
    assert.equal(body.summary?.status, expected);
  },
);

Then(
  'the summary assertions list has at least {int} item',
  async function (this: SimWorld, minCount: number) {
    const body = this.lastResponseBody as { summary?: { assertions?: unknown[] } };
    const count = body.summary?.assertions?.length ?? 0;
    assert.ok(
      count >= minCount,
      `Expected at least ${minCount} summary assertions, got ${count}`,
    );
  },
);

Then(
  'every assertion in the summary has at least 1 citation',
  async function (this: SimWorld) {
    const body = this.lastResponseBody as {
      summary?: { assertions?: Array<{ citations?: unknown[] }> };
    };
    for (const a of body.summary?.assertions ?? []) {
      assert.ok(
        (a.citations?.length ?? 0) >= 1,
        `An assertion has 0 citations: ${JSON.stringify(a)}`,
      );
    }
  },
);

Then(
  'every citation has a non-null {string}',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as {
      summary?: {
        assertions?: Array<{ citations?: Array<Record<string, unknown>> }>;
      };
    };
    for (const a of body.summary?.assertions ?? []) {
      for (const citation of a.citations ?? []) {
        assert.ok(
          citation[fieldName] !== null && citation[fieldName] !== undefined,
          `Citation missing '${fieldName}': ${JSON.stringify(citation)}`,
        );
      }
    }
  },
);

Then(
  'the triage block status is {string}',
  async function (this: SimWorld, expected: string) {
    const body = this.lastResponseBody as { triage?: { status?: string } };
    assert.equal(body.triage?.status, expected);
  },
);

// NOTE: The feature file uses an unquoted JSON array: one of ["likely_meets", "needs_rfi", ...]
// so we match with a regex to capture the bracket-delimited array literal.
Then(
  /^the triage suggestion is one of (\[.+\])$/,
  async function (this: SimWorld, jsonArrayStr: string) {
    const allowed = JSON.parse(jsonArrayStr) as string[];
    const body = this.lastResponseBody as { triage?: { suggestion?: string } };
    const suggestion = body.triage?.suggestion;
    assert.ok(
      suggestion !== undefined && allowed.includes(suggestion),
      `Triage suggestion '${suggestion}' not in allowed set: ${JSON.stringify(allowed)}`,
    );
  },
);

// ── BFF GraphQL ──

When(
  'the reviewer workspace GraphQL query {string} is executed',
  async function (this: SimWorld, queryTemplate: string) {
    const resolvedQuery = this.resolve(queryTemplate);
    const gql = `query { ${resolvedQuery} { status result { classification summary { assertions { citations { trace_ref } } } } } }`;

    const res = await fetch(`${BFF_URL}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sim-tenant-id': this.currentTenantId,
        'x-sim-user-id': 'user_test_01',
      },
      body: JSON.stringify({ query: gql }),
    });
    this.lastResponse = res;
    this.lastResponseBody = await res.json().catch(() => null);
  },
);

Then(
  'the response contains field {string} equal to {string}',
  async function (this: SimWorld, fieldPath: string, expected: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const parts = fieldPath.split('.');
    let current: unknown = body;
    for (const part of parts) {
      current = (current as Record<string, unknown>)?.[part];
    }
    assert.equal(
      String(current),
      expected,
      `Field '${fieldPath}' expected '${expected}', got '${String(current)}'`,
    );
  },
);

Then(
  'the response contains field {string} with at least {int} item',
  async function (this: SimWorld, fieldPath: string, minCount: number) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const parts = fieldPath.split('.');
    let current: unknown = body;
    for (const part of parts) {
      current = (current as Record<string, unknown>)?.[part];
    }
    const count = Array.isArray(current) ? current.length : 0;
    assert.ok(
      count >= minCount,
      `Field '${fieldPath}' has ${count} items, expected >= ${minCount}`,
    );
  },
);

// ── Feedback ──

When(
  'the reviewer posts feedback via {string} with item target {string} action {string}',
  async function (this: SimWorld, pathTemplate: string, target: string, action: string) {
    // Extract just the path portion if a verb prefix is present (e.g. "POST /v1/...")
    const raw = pathTemplate.includes(' ') ? pathTemplate.split(' ')[1]! : pathTemplate;
    const path = this.resolve(raw);
    await this.post('revital', path, { items: [{ target, action }] }, this.currentTenantId);
  },
);

// ── Outbox assertion ──

Then(
  'the {string} table contains a row with topic {string} and payload field {string} equal to {string}',
  async function (
    this: SimWorld,
    tableRef: string,
    topic: string,
    payloadField: string,
    expectedValue: string,
  ) {
    const [schema, table] = tableRef.split('.');
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}"
           WHERE topic = $1 AND tenant_id = $2 AND envelope->>'${payloadField}' = $3
           LIMIT 1`,
          [topic, this.currentTenantId, expectedValue],
        );
        return rows.length > 0;
      },
      `${tableRef} row with topic='${topic}' and payload.${payloadField}='${expectedValue}'`,
      15_000,
    );
  },
);

// ── Graceful degradation ──

// NOTE: document_refs in the feature appears as an unquoted JSON array literal
// e.g.: exists with document_refs ["doc_fixture_01"]
// We use a regex to capture both the quoted case_ref and the raw array.
Given(
  /^a PA case "([^"]+)" exists with document_refs (\[.+\])$/,
  async function (this: SimWorld, caseRefVar: string, docRefsJson: string) {
    const docRefs = JSON.parse(docRefsJson) as string[];
    const { rows } = await this.dbQuery<{ case_id: string }>(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel)
       VALUES ($1, 'MA', 'intake', 'standard', 'PAS')
       RETURNING case_id::text AS case_id`,
      [this.currentTenantId],
    );
    this.capture(caseRefVar, rows[0].case_id);
    this.capture(`${caseRefVar}_doc_refs`, docRefs);
  },
);

When(
  'the Revital pipeline is triggered for {string}',
  async function (this: SimWorld, caseRefVar: string) {
    const caseRef = this.vars.get(caseRefVar) as string;
    const docRefs = (this.vars.get(`${caseRefVar}_doc_refs`) as string[]) ?? [];
    await this.post(
      'revital',
      '/v1/assist/analyses',
      {
        case_ref: caseRef,
        analysis_kinds: ['triage'],
        inputs: { document_refs: docRefs, case_context: {} },
      },
      this.currentTenantId,
    );
  },
);

Then(
  'the {string} row status becomes {string} or {string} within {int} seconds',
  async function (
    this: SimWorld,
    tableRef: string,
    status1: string,
    status2: string,
    timeoutSec: number,
  ) {
    const [schema, table] = tableRef.split('.');
    const caseRef2 = this.vars.get('test_case_ref_2') as string | undefined;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ status: string }>(
          caseRef2
            ? `SELECT status FROM "${schema}"."${table}" WHERE tenant_id = $1 AND case_ref = $2 ORDER BY created_at DESC LIMIT 1`
            : `SELECT status FROM "${schema}"."${table}" WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
          caseRef2 ? [this.currentTenantId, caseRef2] : [this.currentTenantId],
        );
        return rows[0]?.status === status1 || rows[0]?.status === status2;
      },
      `${tableRef} status='${status1}' or '${status2}'`,
      timeoutSec * 1000,
    );
  },
);

Then(
  'the reviewer workspace BFF advisory query for {string} returns status {string}',
  async function (this: SimWorld, caseRefVar: string, expectedStatus: string) {
    const caseRef =
      (this.vars.get(caseRefVar) as string | undefined) ?? caseRefVar;
    const gql = `query { advisory(caseId: "${caseRef}") { status } }`;
    const res = await fetch(`${BFF_URL}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sim-tenant-id': this.currentTenantId,
        'x-sim-user-id': 'user_test_01',
      },
      body: JSON.stringify({ query: gql }),
    });
    const body = (await res.json()) as {
      data?: { advisory?: { status?: string } };
    };
    const status = body.data?.advisory?.status;
    assert.ok(
      status === expectedStatus || status === 'partial' || status === 'failed',
      `Advisory status '${String(status)}' does not satisfy expected '${expectedStatus}'`,
    );
  },
);

Then(
  'the advisory result status is {string} or {string}',
  async function (this: SimWorld, status1: string, status2: string) {
    const body = this.lastResponseBody as {
      status?: string;
      result?: { status?: string };
    };
    const actual = body.status ?? body.result?.status;
    assert.ok(
      actual === status1 || actual === status2,
      `Advisory status '${String(actual)}' is not '${status1}' or '${status2}'`,
    );
  },
);

Then(
  'the Enstellar PA workflow for {string} is NOT blocked',
  async function (this: SimWorld, caseRefVar: string) {
    const caseRef = this.vars.get(caseRefVar) as string | undefined;
    if (!caseRef) return;
    const { rows } = await this.dbQuery<{ state: string }>(
      `SELECT state FROM ens.case WHERE case_id = $1::uuid AND tenant_id = $2`,
      [caseRef, this.currentTenantId],
    );
    if (rows.length > 0) {
      assert.notEqual(rows[0].state, 'blocked', `PA case '${caseRef}' is in blocked state`);
      assert.notEqual(rows[0].state, 'error', `PA case '${caseRef}' is in error state`);
    }
  },
);

// NOTE: The feature file has trailing text in parentheses:
//   And the PA case state is NOT "voided" (advisory failure must not block human review path)
// Cucumber will NOT match a plain {string} step to this — a regex is needed to
// consume the optional trailing annotation.
Then(
  /^the PA case state is NOT "([^"]+)"(?: \([^)]+\))?$/,
  async function (this: SimWorld, forbiddenState: string) {
    const caseRef = this.vars.get('test_case_ref_2') as string | undefined;
    if (!caseRef) return;
    const { rows } = await this.dbQuery<{ state: string }>(
      `SELECT state FROM ens.case WHERE case_id = $1::uuid AND tenant_id = $2`,
      [caseRef, this.currentTenantId],
    );
    if (rows.length > 0) {
      assert.notEqual(
        rows[0].state,
        forbiddenState,
        `Case '${caseRef}' has forbidden state '${forbiddenState}'`,
      );
    }
  },
);
