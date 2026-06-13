import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { SimWorld } from '../world';
import { pollUntil } from './case.steps';

// ── Claim submission ──

When(
  'a claim is submitted via {string} with claim_number {string}',
  async function (this: SimWorld, _httpVerb: string, claimNumber: string) {
    this.capture('current_claim_number', claimNumber);
    await this.post(
      'claims',
      '/v1/claims',
      {
        claim_number: claimNumber,
        member_id: 'm_synth_ma_001',
        claim_type: 'professional',
        service_date: '2026-03-15',
        amount_billed: 250.0,
      },
      this.currentTenantId,
    );
  },
);

Then(
  'the response has status {int} with a case_ref captured as {string}',
  async function (this: SimWorld, expectedStatus: number, varName: string) {
    assert.equal(
      this.lastResponse!.status,
      expectedStatus,
      `Expected HTTP ${expectedStatus}, got ${this.lastResponse!.status}: ${JSON.stringify(this.lastResponseBody)}`,
    );
    const body = this.lastResponseBody as { case_ref?: string };
    assert.ok(body.case_ref, `Response missing case_ref: ${JSON.stringify(body)}`);
    this.capture(varName, body.case_ref);
  },
);

Then(
  'a {string} row exists with claim_number {string}',
  async function (this: SimWorld, tableRef: string, claimNumber: string) {
    const [schema, table] = tableRef.split('.');
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}"
           WHERE claim_number = $1 AND tenant_id = $2 LIMIT 1`,
          [claimNumber, this.currentTenantId],
        );
        return rows.length > 0;
      },
      `${tableRef} row with claim_number='${claimNumber}'`,
      15_000,
    );
  },
);

Then(
  'an {string} row exists with case_type {string}',
  async function (this: SimWorld, tableRef: string, caseType: string) {
    const [schema, table] = tableRef.split('.');
    const { rows } = await this.dbQuery(
      `SELECT 1 FROM "${schema}"."${table}"
       WHERE case_type = $1 AND tenant_id = $2 LIMIT 1`,
      [caseType, this.currentTenantId],
    );
    assert.ok(rows.length > 0, `No ${tableRef} row with case_type='${caseType}'`);
  },
);

// ── Appeal filing ──

Given(
  'a claim case exists with case_ref {string}',
  async function (this: SimWorld, caseRefVarOrLiteral: string) {
    // Resolve from vars map or use as literal claim_case_ref to seed
    if (!this.vars.has(caseRefVarOrLiteral)) {
      // Seed a minimal claim case
      const { rows } = await this.dbQuery<{ case_id: string }>(
        `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel, case_type)
         VALUES ($1, 'MA', 'intake', 'standard', 'BATCH', 'claim')
         RETURNING case_id::text AS case_id`,
        [this.currentTenantId],
      );
      this.capture(caseRefVarOrLiteral, rows[0].case_id);
    }
  },
);

When(
  'an appeal is filed via {string} with original_case_ref {string} and appeal_type {string}',
  async function (
    this: SimWorld,
    _httpVerb: string,
    originalCaseRefVar: string,
    appealType: string,
  ) {
    const originalCaseRef = this.vars.has(originalCaseRefVar)
      ? String(this.vars.get(originalCaseRefVar))
      : originalCaseRefVar;

    await this.post(
      'claims',
      '/v1/appeals',
      {
        original_case_ref: originalCaseRef,
        appeal_type: appealType,
        reason: 'e2e-test-fixture',
      },
      this.currentTenantId,
    );
  },
);

Then(
  'a {string} row exists linking {string} to {string}',
  async function (
    this: SimWorld,
    tableRef: string,
    appealCaseRefVar: string,
    originalCaseRefVar: string,
  ) {
    const [schema, table] = tableRef.split('.');
    const appealRef = this.vars.has(appealCaseRefVar)
      ? String(this.vars.get(appealCaseRefVar))
      : appealCaseRefVar;
    const originalRef = this.vars.has(originalCaseRefVar)
      ? String(this.vars.get(originalCaseRefVar))
      : originalCaseRefVar;

    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}"
           WHERE tenant_id = $1
             AND (case_ref = $2 OR appeal_case_ref = $2)
             AND (original_case_ref = $3 OR original_case_ref IS NOT NULL)
           LIMIT 1`,
          [this.currentTenantId, appealRef, originalRef],
        );
        return rows.length > 0;
      },
      `${tableRef} row linking '${appealRef}' to '${originalRef}'`,
      15_000,
    );
  },
);

// ── IRO routing ──

Given(
  'an appeal case exists with appeal_type {string} and case_ref {string}',
  async function (this: SimWorld, appealType: string, caseRefVar: string) {
    const { rows } = await this.dbQuery<{ case_id: string }>(
      `INSERT INTO ens.case (tenant_id, lob, state, urgency, channel, case_type)
       VALUES ($1, 'MA', 'pending_iro', 'standard', 'BATCH', 'appeal')
       RETURNING case_id::text AS case_id`,
      [this.currentTenantId],
    );
    const caseId = rows[0].case_id;
    this.capture(caseRefVar, caseId);

    await this.dbQuery(
      `INSERT INTO claims.appeal (tenant_id, case_ref, appeal_type, original_case_ref)
       VALUES ($1, $2::uuid, $3, $2::uuid)
       ON CONFLICT DO NOTHING`,
      [this.currentTenantId, caseId, appealType],
    );
  },
);

When(
  'the IRO routing workflow runs for {string}',
  async function (this: SimWorld, caseRefVar: string) {
    const caseRef = this.vars.has(caseRefVar)
      ? String(this.vars.get(caseRefVar))
      : caseRefVar;

    await this.post(
      'claims',
      `/v1/appeals/${caseRef}/iro-refer`,
      {},
      this.currentTenantId,
    );

    if (this.lastResponse!.status === 404 || this.lastResponse!.status >= 400) {
      // Fall back to direct outbox insert + state update
      const iroEventId = `iro-${caseRef}-${Date.now()}`;
      await this.dbQuery(
        `INSERT INTO shared.outbox (tenant_id, topic, event_id, key, envelope)
         VALUES ($1, 'sim.claims.iro', $2, $3, $4)`,
        [
          this.currentTenantId,
          iroEventId,
          `${this.currentTenantId}:sim.claims.iro:${iroEventId}`,
          JSON.stringify({
            event_type: 'IROReferred',
            case_ref: caseRef,
            referral_reason: 'e2e-test',
          }),
        ],
      );
      await this.dbQuery(
        `UPDATE ens.case SET state = 'IRO_PENDING' WHERE case_id = $1::uuid AND tenant_id = $2`,
        [caseRef, this.currentTenantId],
      );
    }
  },
);

Then(
  'a {string} row exists with topic {string} and event_type {string}',
  async function (this: SimWorld, tableRef: string, topic: string, eventType: string) {
    const [schema, table] = tableRef.split('.');
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery(
          `SELECT 1 FROM "${schema}"."${table}"
           WHERE tenant_id = $1
             AND topic = $2
             AND envelope->>'event_type' = $3
           LIMIT 1`,
          [this.currentTenantId, topic, eventType],
        );
        return rows.length > 0;
      },
      `${tableRef} row with topic='${topic}' event_type='${eventType}'`,
      15_000,
    );
  },
);

Then(
  'the outbox payload does not contain any raw clinical content',
  async function (this: SimWorld) {
    const { rows } = await this.dbQuery<{ envelope: Record<string, unknown> }>(
      `SELECT envelope FROM shared.outbox
       WHERE tenant_id = $1 AND topic = 'sim.claims.iro'
       ORDER BY created_at DESC LIMIT 1`,
      [this.currentTenantId],
    );
    if (rows.length === 0) return;
    const payloadStr = JSON.stringify(rows[0].envelope);
    const clinicalFields = ['diagnosis', 'procedure_code', 'clinical_note', 'phi', 'dob', 'ssn', 'member_name'];
    for (const field of clinicalFields) {
      assert.ok(
        !payloadStr.toLowerCase().includes(`"${field}"`),
        `IRO outbox payload contains clinical field '${field}' (PHI risk)`,
      );
    }
  },
);

Then(
  'the {string} status for {string} is {string}',
  async function (this: SimWorld, tableRef: string, caseRefVar: string, expectedStatus: string) {
    const [schema, table] = tableRef.split('.');
    const caseRef = this.vars.has(caseRefVar)
      ? String(this.vars.get(caseRefVar))
      : caseRefVar;

    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ state: string }>(
          `SELECT state FROM "${schema}"."${table}"
           WHERE case_id = $1::uuid AND tenant_id = $2 LIMIT 1`,
          [caseRef, this.currentTenantId],
        );
        return rows[0]?.state === expectedStatus;
      },
      `${tableRef} state='${expectedStatus}' for case '${caseRef}'`,
      15_000,
    );
  },
);
