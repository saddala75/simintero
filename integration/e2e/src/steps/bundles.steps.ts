import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';

const ACME_TENANT = 'acme';

Given(
  'no bundle with ref {string} exists for tenant {string}',
  async function (this: SimWorld, bundleRef: string, tenantId: string) {
    await this.dbQuery(
      `DELETE FROM market.bundle WHERE bundle_ref = $1 AND tenant_id = $2`,
      [bundleRef, tenantId],
    );
  },
);

When(
  'tenant {string} provisions bundle ref {string} for lob {string}',
  async function (this: SimWorld, tenantId: string, bundleRef: string, lob: string) {
    this.capture('current_bundle_ref', bundleRef);
    this.capture('current_bundle_tenant', tenantId);
    await this.post(
      'marketBundles',
      '/v1/market/bundles',
      { bundle_ref: bundleRef, lob, source: 'e2e-fixture' },
      tenantId,
    );
  },
);

Then(
  'the bundle status in the response is {string}',
  async function (this: SimWorld, expectedStatus: string) {
    const body = this.lastResponseBody as { status?: string; bundle?: { status?: string } };
    const actual = body.status ?? body.bundle?.status;
    assert.equal(
      actual,
      expectedStatus,
      `Bundle response status expected '${expectedStatus}', got '${actual}': ${JSON.stringify(body)}`,
    );
    // Security guard: bundles must never be created as 'active'
    assert.notEqual(actual, 'active', `Bundle created with status 'active' — clinical review required before activation`);
  },
);

Then(
  'the market.bundle record for {string} has status {string}',
  async function (this: SimWorld, bundleRef: string, expectedStatus: string) {
    const tenantId = (this.vars.get('current_bundle_tenant') as string) ?? ACME_TENANT;
    const { rows } = await this.dbQuery<{ status: string }>(
      `SELECT status FROM market.bundle WHERE bundle_ref = $1 AND tenant_id = $2 LIMIT 1`,
      [bundleRef, tenantId],
    );
    assert.ok(rows.length > 0, `No market.bundle row for ref '${bundleRef}'`);
    assert.equal(rows[0].status, expectedStatus);
    // Security guard
    assert.notEqual(rows[0].status, 'active', `market.bundle '${bundleRef}' is 'active' — must remain 'draft' without clinical review`);
  },
);

Given(
  'a bundle {string} exists with status {string} for tenant {string}',
  async function (this: SimWorld, bundleRef: string, status: string, tenantId: string) {
    // Security guard: never seed an 'active' bundle in tests
    assert.notEqual(status, 'active', `Test must not create a bundle with status='active' without clinical review`);
    this.capture('current_bundle_ref', bundleRef);
    this.capture('current_bundle_tenant', tenantId);
    await this.dbQuery(
      `INSERT INTO market.bundle (tenant_id, bundle_ref, lob, status, source)
       VALUES ($1, $2, 'MA', $3, 'e2e-fixture')
       ON CONFLICT (tenant_id, bundle_ref) DO UPDATE SET status = $3`,
      [tenantId, bundleRef, status],
    );
  },
);

When(
  'an activation request is made without a reviewer_id',
  async function (this: SimWorld) {
    const bundleRef = this.vars.get('current_bundle_ref') as string;
    const tenantId = (this.vars.get('current_bundle_tenant') as string) ?? ACME_TENANT;
    await this.post(
      'marketBundles',
      `/v1/market/bundles/${bundleRef}/activate`,
      {},  // No reviewer_id — BundleValidator should reject this
      tenantId,
    );
  },
);

Then(
  'the BundleValidator rejects the request',
  async function (this: SimWorld) {
    const status = this.lastResponse!.status;
    assert.ok(
      status === 400 || status === 422 || status === 403,
      `BundleValidator expected 400/422/403, got ${status}: ${JSON.stringify(this.lastResponseBody)}`,
    );
  },
);

Then(
  'the error contains {string}',
  async function (this: SimWorld, expectedFragment: string) {
    const bodyStr = JSON.stringify(this.lastResponseBody);
    assert.ok(
      bodyStr.includes(expectedFragment),
      `Error response does not contain '${expectedFragment}': ${bodyStr}`,
    );
  },
);

Given(
  'bundle {string} with lob {string} exists for tenant {string}',
  async function (this: SimWorld, bundleRef: string, lob: string, tenantId: string) {
    this.capture('current_bundle_ref', bundleRef);
    this.capture('current_bundle_tenant', tenantId);
    await this.dbQuery(
      `INSERT INTO market.bundle (tenant_id, bundle_ref, lob, status, source)
       VALUES ($1, $2, $3, 'draft', 'e2e-fixture')
       ON CONFLICT (tenant_id, bundle_ref) DO UPDATE SET lob = $3`,
      [tenantId, bundleRef, lob],
    );
  },
);

Given(
  'the bundle has artifact {string} with role {string}',
  async function (this: SimWorld, artifactRef: string, role: string) {
    const bundleRef = this.vars.get('current_bundle_ref') as string;
    const tenantId = (this.vars.get('current_bundle_tenant') as string) ?? ACME_TENANT;
    this.capture('current_artifact_role', role);
    await this.dbQuery(
      `INSERT INTO market.bundle_artifact (tenant_id, bundle_ref, artifact_ref, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, bundle_ref, artifact_ref) DO NOTHING`,
      [tenantId, bundleRef, artifactRef, role],
    );
  },
);

When(
  'tenant {string} requests bundle ref {string}',
  async function (this: SimWorld, tenantId: string, bundleRef: string) {
    await this.get('marketBundles', `/v1/market/bundles/${bundleRef}`, tenantId);
  },
);

Then(
  'the response includes the {string} artifact',
  async function (this: SimWorld, role: string) {
    const body = this.lastResponseBody as {
      artifacts?: Array<{ role: string }>;
      bundle?: { artifacts?: Array<{ role: string }> };
    };
    const artifacts = body.artifacts ?? body.bundle?.artifacts ?? [];
    const match = artifacts.find((a) => a.role === role);
    assert.ok(
      match !== undefined,
      `Response does not include artifact with role '${role}'. Artifacts: ${JSON.stringify(artifacts)}`,
    );
  },
);
