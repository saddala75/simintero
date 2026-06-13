import { Given, When, Then, After } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { SimWorld, SERVICE_BASE } from '../world';

// Fixed deterministic UUIDs for E2E fixture documents
const FIXTURE_UUIDS: Record<string, string> = {
  doc_fixture_01:    'a0e10001-0000-4000-8000-000000000001',
  quarantine_doc_01: 'a0e10002-0000-4000-8000-000000000002',
};

function resolveDocId(name: string): string {
  return FIXTURE_UUIDS[name] ?? name;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let capturedViewId: string | null = null;

// ─── Background steps ──────────────────────────────────────────────────────

Given('the Document Service is running at the configured URL', async function (this: SimWorld) {
  const url = SERVICE_BASE['document'];
  const res = await fetch(`${url}/healthz`);
  assert.equal(res.status, 200, `Document Service not healthy at ${url}/healthz`);
});

Given('the Presidio analyzer and anonymizer are running', async function () {
  const analyzerUrl = process.env['PRESIDIO_ANALYZER_URL'] ?? 'http://localhost:5001';
  const anonymizerUrl = process.env['PRESIDIO_ANONYMIZER_URL'] ?? 'http://localhost:5002';

  for (const [label, url] of [['Presidio Analyzer', analyzerUrl], ['Presidio Anonymizer', anonymizerUrl]] as [string, string][]) {
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch(`${url}/health`);
        if (res.ok) { healthy = true; break; }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    assert.ok(healthy, `${label} did not become healthy within 30 seconds at ${url}/health`);
  }
});

Given(
  'the synthetic MA tenant {string} has a clean document with doc_id {string}',
  async function (this: SimWorld, tenantId: string, docName: string) {
    const docId = resolveDocId(docName);
    await this.dbQuery(
      `INSERT INTO docs.document (doc_id, tenant_id, virus_scan_status, source_channel, object_key, created_by)
       VALUES ($1::uuid, $2, 'clean', 'portal_upload', $3, '{"system":"e2e_fixture"}'::jsonb)
       ON CONFLICT (doc_id) DO UPDATE SET virus_scan_status = 'clean'`,
      [docId, tenantId, `${tenantId}/docs/${docId}/raw`],
      tenantId,
    );
  },
);

// ─── Given steps ───────────────────────────────────────────────────────────

Given(
  'a document {string} exists for tenant {string} with virus_scan_status {string}',
  async function (this: SimWorld, docName: string, tenantId: string, status: string) {
    const docId = resolveDocId(docName);
    await this.dbQuery(
      `INSERT INTO docs.document (doc_id, tenant_id, virus_scan_status, source_channel, object_key, created_by)
       VALUES ($1::uuid, $2, $3, 'portal_upload', $4, '{"system":"e2e_fixture"}'::jsonb)
       ON CONFLICT (doc_id) DO UPDATE SET virus_scan_status = EXCLUDED.virus_scan_status`,
      [docId, tenantId, status, `${tenantId}/docs/${docId}/raw`],
      tenantId,
    );
  },
);

// ─── When steps ────────────────────────────────────────────────────────────

When(
  'a redaction is requested for document {string} by tenant {string}',
  async function (this: SimWorld, docName: string, tenantId: string) {
    capturedViewId = null;
    const docId = resolveDocId(docName);
    await this.post('document', `/documents/${docId}/redact`, {}, tenantId);

    if (this.lastResponse?.status === 201) {
      const body = this.lastResponseBody as Record<string, unknown>;
      capturedViewId = typeof body['view_id'] === 'string' ? body['view_id'] : null;
    }
  },
);

When(
  'the redaction view is fetched using the returned view_id for document {string} by tenant {string}',
  async function (this: SimWorld, docName: string, tenantId: string) {
    assert.ok(capturedViewId, 'No view_id was captured from the previous POST /redact call');
    const docId = resolveDocId(docName);
    await this.get('document', `/documents/${docId}/redactions/${capturedViewId}`, tenantId);
  },
);

// ─── Then steps ────────────────────────────────────────────────────────────

Then(
  'the response body contains field {string} as a UUID',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const value = body[fieldName];
    assert.ok(
      typeof value === 'string' && UUID_PATTERN.test(value),
      `Expected field "${fieldName}" to be a UUID, got: ${JSON.stringify(value)}`,
    );
  },
);

Then(
  'the response body contains field {string} as a positive integer',
  async function (this: SimWorld, fieldName: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const value = body[fieldName];
    assert.ok(
      typeof value === 'number' && Number.isInteger(value) && value > 0,
      `Expected field "${fieldName}" to be a positive integer, got: ${JSON.stringify(value)}`,
    );
  },
);

Then(
  'the docs.redaction_view table contains a row for document {string} in tenant {string}',
  async function (this: SimWorld, docName: string, tenantId: string) {
    const docId = resolveDocId(docName);
    const { rows } = await this.dbQuery(
      `SELECT redacted_text FROM docs.redaction_view
       WHERE doc_id = $1::uuid AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, tenantId],
      tenantId,
    );
    assert.ok(rows.length > 0, `Expected a redaction_view row for doc_id=${docId}, tenant=${tenantId}`);
    assert.ok(
      (rows[0].redacted_text as string)?.includes('[REDACTED'),
      `Expected redacted_text to contain [REDACTED markers, got: ${rows[0].redacted_text}`,
    );
  },
);

Then(
  'the response body contains field {string} equal to {string}',
  async function (this: SimWorld, fieldName: string, expectedValue: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    assert.equal(
      body[fieldName],
      expectedValue,
      `Expected field "${fieldName}" = "${expectedValue}", got: ${JSON.stringify(body[fieldName])}`,
    );
  },
);

Then(
  'the response body field {string} does not contain {string}',
  async function (this: SimWorld, fieldName: string, substring: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const value = String(body[fieldName] ?? '');
    assert.ok(
      !value.includes(substring),
      `Expected field "${fieldName}" NOT to contain "${substring}", but it did. Value: ${value}`,
    );
  },
);

Then(
  'the response body field {string} contains {string}',
  async function (this: SimWorld, fieldName: string, substring: string) {
    const body = this.lastResponseBody as Record<string, unknown>;
    const value = String(body[fieldName] ?? '');
    assert.ok(
      value.includes(substring),
      `Expected field "${fieldName}" to contain "${substring}". Value: ${value}`,
    );
  },
);

// ─── Cleanup ───────────────────────────────────────────────────────────────

After({ tags: '@phase5e' }, async function (this: SimWorld) {
  const cleanDocId = resolveDocId('doc_fixture_01');
  const quarDocId = resolveDocId('quarantine_doc_01');

  await this.dbQuery(
    `DELETE FROM docs.redaction_view WHERE doc_id IN ($1::uuid, $2::uuid) AND tenant_id = 't_synth_ma'`,
    [cleanDocId, quarDocId],
    't_synth_ma',
  ).catch(() => undefined);

  await this.cleanup();
});
