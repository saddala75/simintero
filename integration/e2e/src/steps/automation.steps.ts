import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';
import { pollUntil } from './case.steps';

const ACME_TENANT = 'acme';

// ── Case setup ──────────────────────────────────────────────────────────────

Given(
  'a case {string} exists for tenant {string}',
  async function (this: SimWorld, caseLabel: string, tenantId: string) {
    this.capture(`case_label_${caseLabel}`, caseLabel);
    const { rows } = await this.dbQuery<{ case_id: string }>(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel)
       VALUES ($1, 'MA', 'intake', 'standard', 'PAS')
       RETURNING case_id::text AS case_id`,
      [tenantId],
    );
    this.capture(caseLabel, rows[0].case_id);
    // Also capture as last_case_ref so generic When steps can find it without hardcoding labels
    this.capture('last_case_ref', rows[0].case_id);
  },
);

// ── Entitlement control ─────────────────────────────────────────────────────
// SECURITY: ai.automation.live MUST default false.
// Tests MUST NOT set ai.automation.live = true.

Given(
  'the {string} entitlement is not set for tenant {string}',
  async function (this: SimWorld, entitlementKey: string, tenantId: string) {
    // Ensure the entitlement is absent — NEVER activate ai.automation.live in tests
    await this.dbQuery(
      `DELETE FROM ctrl.entitlement
       WHERE tenant_id = $1 AND key = $2`,
      [tenantId, entitlementKey],
    );
  },
);

// ── OPA gate declarative precondition ───────────────────────────────────────

Given(
  'the OPA gate would allow the disposition',
  async function (this: SimWorld) {
    // No-op: for non-adverse outcomes with confidence >= threshold, OPA allows by policy.
    // The actual gate logic lives in the automation service; this step is declarative.
  },
);

// ── Disposition requests ─────────────────────────────────────────────────────

When(
  'the automation service receives a disposition request with proposed_outcome {string}',
  async function (this: SimWorld, proposedOutcome: string) {
    const caseRef = (this.vars.get('last_case_ref') as string | undefined) ?? null;

    await this.post(
      'automation',
      '/v1/automation/disposition',
      {
        case_ref: caseRef,
        proposed_outcome: proposedOutcome,
        confidence: 0.95,
        reasoning: 'e2e-test',
      },
      ACME_TENANT,
    );
    this.capture('last_proposed_outcome', proposedOutcome);
    this.capture('last_disposition_case_ref', caseRef);
  },
);

When(
  'the automation service processes a disposition for case {string} with proposed_outcome {string}',
  async function (this: SimWorld, caseLabel: string, proposedOutcome: string) {
    const caseRef = (this.vars.get(caseLabel) as string | undefined) ?? null;

    await this.post(
      'automation',
      '/v1/automation/disposition',
      {
        case_ref: caseRef,
        proposed_outcome: proposedOutcome,
        confidence: 0.95,
        reasoning: 'e2e-test',
      },
      ACME_TENANT,
    );
    this.capture('last_proposed_outcome', proposedOutcome);
    this.capture('last_disposition_case_ref', caseRef);
  },
);

// ── Assertions ───────────────────────────────────────────────────────────────

Then(
  'the error code is {string}',
  async function (this: SimWorld, expectedCode: string) {
    const body = this.lastResponseBody as {
      error_code?: string;
      code?: string;
      error?: { code?: string };
    };
    const actual = body.error_code ?? body.code ?? body.error?.code;
    assert.equal(
      actual,
      expectedCode,
      `Expected error code '${expectedCode}', got '${String(actual)}': ${JSON.stringify(body)}`,
    );
  },
);

Then(
  'no automation.disposition_log entry has allow = true for case {string}',
  async function (this: SimWorld, caseLabel: string) {
    const caseRef = this.vars.get(caseLabel) as string | undefined;
    if (!caseRef) return;
    const { rows } = await this.dbQuery<{ count: string }>(
      `SELECT COUNT(*) AS count FROM automation.disposition_log
       WHERE case_ref = $1 AND allow = true`,
      [caseRef],
    );
    assert.equal(
      parseInt(rows[0].count, 10),
      0,
      `Found disposition_log entry with allow=true for case '${caseLabel}' — adverse disposition should never be allowed`,
    );
  },
);

Then(
  'the ens.case state for {string} is not {string}',
  async function (this: SimWorld, caseLabel: string, forbiddenState: string) {
    const caseRef = this.vars.get(caseLabel) as string | undefined;
    if (!caseRef) return;
    const { rows } = await this.dbQuery<{ state: string }>(
      `SELECT state FROM ens.case WHERE case_id = $1::uuid LIMIT 1`,
      [caseRef],
    );
    if (rows.length > 0) {
      assert.notEqual(
        rows[0].state,
        forbiddenState,
        `Case '${caseLabel}' is in state '${forbiddenState}' — dry-run should not mutate case state`,
      );
    }
  },
);

Then(
  'an automation.disposition_log entry exists for case {string}',
  async function (this: SimWorld, caseLabel: string) {
    const caseRef = this.vars.get(caseLabel) as string | undefined;
    if (!caseRef) return;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ disposition_id: string }>(
          `SELECT disposition_id FROM automation.disposition_log WHERE case_ref = $1 LIMIT 1`,
          [caseRef],
        );
        if (rows.length > 0) {
          this.capture('last_log_id', rows[0].disposition_id);
          return true;
        }
        return false;
      },
      `automation.disposition_log entry for case '${caseLabel}'`,
      15_000,
    );
  },
);

Then(
  'the disposition_log entry has allow = false',
  async function (this: SimWorld) {
    const logId = this.vars.get('last_log_id') as string | undefined;
    const caseRef = this.vars.get('last_disposition_case_ref') as string | undefined;
    const { rows } = await this.dbQuery<{ allow: boolean }>(
      logId
        ? `SELECT allow FROM automation.disposition_log WHERE disposition_id = $1 LIMIT 1`
        : `SELECT allow FROM automation.disposition_log WHERE case_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [logId ?? caseRef],
    );
    assert.ok(rows.length > 0, `No disposition_log entry found`);
    assert.equal(rows[0].allow, false, `disposition_log.allow expected false, got ${String(rows[0].allow)}`);
  },
);

Then(
  'the disposition_log entry has dry_run = true',
  async function (this: SimWorld) {
    const logId = this.vars.get('last_log_id') as string | undefined;
    const caseRef = this.vars.get('last_disposition_case_ref') as string | undefined;
    const { rows } = await this.dbQuery<{ dry_run: boolean }>(
      logId
        ? `SELECT dry_run FROM automation.disposition_log WHERE disposition_id = $1 LIMIT 1`
        : `SELECT dry_run FROM automation.disposition_log WHERE case_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [logId ?? caseRef],
    );
    assert.ok(rows.length > 0, `No disposition_log entry found`);
    assert.equal(rows[0].dry_run, true, `disposition_log.dry_run expected true, got ${String(rows[0].dry_run)}`);
  },
);
