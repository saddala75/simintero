import { Given, When, Then } from '@cucumber/cucumber';
import { Connection, Client } from '@temporalio/client';
import assert from 'node:assert/strict';
import { fetch } from 'undici';
import { SimWorld, SERVICE_BASE } from '../world';
import { pollUntil } from './case.steps';

// ---------------------------------------------------------------------------
// Temporal client — lazy singleton per test run
// ---------------------------------------------------------------------------

let _temporalClient: Client | null = null;

async function getTemporalClient(): Promise<Client> {
  if (_temporalClient) return _temporalClient;
  const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
  const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'simintero';
  const connection = await Connection.connect({ address });
  _temporalClient = new Client({ connection, namespace });
  return _temporalClient;
}

async function queryWorkflowState(workflowId: string): Promise<string | null> {
  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query<string>('status');
  } catch {
    return null;
  }
}

async function signalWorkflow(workflowId: string, signalName: string, payload: unknown): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal(signalName, payload);
}

// ---------------------------------------------------------------------------
// Resolve {var_name} placeholders from this.vars
// ---------------------------------------------------------------------------

function resolveVars(template: string, vars: Map<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = vars.get(key);
    if (val === undefined) throw new Error(`Step variable "{${key}}" is not set`);
    return String(val);
  });
}

// ---------------------------------------------------------------------------
// Last outbox row captured for follow-up payload assertions
// ---------------------------------------------------------------------------

let _lastOutboxEnvelope: Record<string, unknown> | null = null;

// ---------------------------------------------------------------------------
// Background step
// ---------------------------------------------------------------------------

Given(
  'the Revital advisory pipeline is configured with the mock Anthropic adapter',
  async function (this: SimWorld) {
    const url = `${SERVICE_BASE['revital'] ?? 'http://localhost:3050'}/v1/admin/model-gateway/mock-enable`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter: 'mock-anthropic', enabled: true }),
    }).catch(() => null);
    if (res && res.status !== 200 && res.status !== 204 && res.status !== 404 && res.status !== 501) {
      throw new Error(`mock-enable returned unexpected status ${res.status}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Scenario 1: PAS submission
// ---------------------------------------------------------------------------

When(
  'a valid PAS ClaimBundle is submitted for member {string} with service_category {string} and urgency {string}',
  async function (this: SimWorld, memberId: string, serviceCategory: string, urgency: string) {
    const cptCode = serviceCategory === 'ortho' ? '27447' : '99213';
    const body = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Claim',
            status: 'active',
            use: 'preauthorization',
            patient: { reference: `Patient/${memberId}` },
            insurance: [{ sequence: 1, focal: true, coverage: { reference: `Coverage/cov-synth-${memberId}` } }],
            priority: { coding: [{ code: urgency === 'expedited' ? 'stat' : 'normal' }] },
            item: [{ sequence: 1, productOrService: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: cptCode }] } }],
          },
        },
      ],
    };
    const fhirUrl = process.env['FHIR_FACADE_URL'] ?? 'http://localhost:8090';
    const res = await fetch(`${fhirUrl}/fhir/Claim/$submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json', 'x-sim-tenant-id': this.currentTenantId, 'x-sim-user-id': 'test-runner' },
      body: JSON.stringify(body),
    });
    this.lastResponse = res;
    this.lastResponseBody = await res.json().catch(() => null);
  },
);

Then(
  'the FHIR facade responds with status {int}',
  async function (this: SimWorld, expectedStatus: number) {
    assert.equal(
      this.lastResponse!.status,
      expectedStatus,
      `Expected FHIR facade HTTP ${expectedStatus}, got ${this.lastResponse!.status}. Body: ${JSON.stringify(this.lastResponseBody)}`,
    );
  },
);

Then(
  'an ens.case row is created for tenant {string} with channel {string} within {int} seconds',
  async function (this: SimWorld, tenantId: string, channel: string, timeoutSeconds: number) {
    let capturedId: string | null = null;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ case_id: string; state: string }>(
          `SELECT case_id::text AS case_id, state FROM ens.case WHERE channel = $1 ORDER BY created_at DESC LIMIT 1`,
          [channel],
          tenantId,
        );
        if (rows[0]) { capturedId = rows[0].case_id; return true; }
        return false;
      },
      `ens.case row with tenant_id=${tenantId} channel=${channel}`,
      timeoutSeconds * 1000,
    );
    this.capture('last_case_id', capturedId!);
  },
);

Then(
  'the case_id is captured as {string}',
  async function (this: SimWorld, varName: string) {
    const caseId = this.vars.get('last_case_id') as string | undefined;
    if (!caseId) throw new Error('No case_id captured — run "an ens.case row is created" step first');
    this.capture(varName, caseId);
  },
);

// ---------------------------------------------------------------------------
// Temporal workflow state steps
// ---------------------------------------------------------------------------

Then(
  'the PaWorkflow {string} starts in state {string} within {int} seconds',
  async function (this: SimWorld, rawId: string, expectedState: string, timeoutSeconds: number) {
    const workflowId = resolveVars(rawId, this.vars);
    await pollUntil(
      async () => (await queryWorkflowState(workflowId)) === expectedState,
      `PaWorkflow ${workflowId} to start in state ${expectedState}`,
      timeoutSeconds * 1000,
    );
  },
);

When(
  'the PaWorkflow {string} advances to state {string} within {int} seconds',
  async function (this: SimWorld, rawId: string, expectedState: string, timeoutSeconds: number) {
    const workflowId = resolveVars(rawId, this.vars);
    await pollUntil(
      async () => (await queryWorkflowState(workflowId)) === expectedState,
      `PaWorkflow ${workflowId} to advance to state ${expectedState}`,
      timeoutSeconds * 1000,
    );
  },
);

// ---------------------------------------------------------------------------
// Revital advisory
// ---------------------------------------------------------------------------

Then(
  'a revital.analysis row exists for case_ref {string} with status {string} within {int} seconds',
  async function (this: SimWorld, rawCaseRef: string, expectedStatus: string, timeoutSeconds: number) {
    const caseRef = resolveVars(rawCaseRef, this.vars);
    let capturedId: string | null = null;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ analysis_id: string }>(
          `SELECT analysis_id FROM revital.analysis WHERE case_ref = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1`,
          [caseRef, expectedStatus],
        );
        if (rows[0]) { capturedId = rows[0].analysis_id; return true; }
        return false;
      },
      `revital.analysis with case_ref=${caseRef} status=${expectedStatus}`,
      timeoutSeconds * 1000,
    );
    this.capture('last_analysis_id', capturedId!);
  },
);

Then(
  'the analysis_id is captured as {string}',
  async function (this: SimWorld, varName: string) {
    const analysisId = this.vars.get('last_analysis_id') as string | undefined;
    if (!analysisId) throw new Error('No analysis_id captured — run the revital.analysis step first');
    this.capture(varName, analysisId);
  },
);

// ---------------------------------------------------------------------------
// Reviewer determination
// ---------------------------------------------------------------------------

When(
  'a reviewer records a determination for case {string} with outcome {string} and decided_by {string}',
  async function (this: SimWorld, rawCaseId: string, outcome: string, decidedById: string) {
    const caseId = resolveVars(rawCaseId, this.vars);
    const bffUrl = SERVICE_BASE['workspaceBff'] ?? 'http://localhost:4010';
    const mutation = `mutation { recordDecision(input: { caseId: "${caseId}", outcome: "${outcome}", rationale: "Synthetic approval for e2e test" }) { determinationId error errorCode } }`;
    const res = await fetch(`${bffUrl}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-tenant-id': this.currentTenantId, 'x-sim-user-id': decidedById },
      body: JSON.stringify({ query: mutation }),
    });
    this.lastResponse = res;
    this.lastResponseBody = await res.json().catch(() => null);
    const body = this.lastResponseBody as { data?: { recordDecision?: { determinationId?: string } } };
    const detId = body?.data?.recordDecision?.determinationId;
    if (detId) this.capture('last_determination_id', detId);
  },
);

Then(
  'the determination response status is {int}',
  async function (this: SimWorld, expectedStatus: number) {
    assert.equal(this.lastResponse!.status, expectedStatus, `Expected HTTP ${expectedStatus} from workspace-bff, got ${this.lastResponse!.status}`);
  },
);

Then(
  'an ens.determination row exists for case {string} with outcome {string}',
  async function (this: SimWorld, rawCaseId: string, expectedOutcome: string) {
    const caseId = resolveVars(rawCaseId, this.vars);
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ determination_id: string }>(
          `SELECT determination_id FROM ens.determination WHERE case_id = $1::uuid AND outcome = $2 LIMIT 1`,
          [caseId, expectedOutcome],
        );
        return rows.length > 0;
      },
      `ens.determination for case ${caseId} with outcome ${expectedOutcome}`,
      5_000,
    );
  },
);

Then(
  'an ens.case_event row exists for case {string} with event_type {string}',
  async function (this: SimWorld, rawCaseId: string, eventType: string) {
    const caseId = resolveVars(rawCaseId, this.vars);
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ seq: number }>(
          `SELECT seq FROM ens.case_event WHERE case_id = $1::uuid AND event_type = $2 LIMIT 1`,
          [caseId, eventType],
        );
        return rows.length > 0;
      },
      `ens.case_event with event_type=${eventType} for case ${caseId}`,
      5_000,
    );
  },
);

// ---------------------------------------------------------------------------
// Outbox assertions
// ---------------------------------------------------------------------------

Then(
  'a shared.outbox row exists with topic {string} and schema_ref {string} for case {string}',
  async function (this: SimWorld, topic: string, schemaRef: string, rawCaseId: string) {
    const caseId = resolveVars(rawCaseId, this.vars);
    let capturedEnvelope: Record<string, unknown> | null = null;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ envelope: Record<string, unknown> }>(
          `SELECT envelope FROM shared.outbox WHERE topic = $1 AND envelope->>'schema_ref' = $2 AND key = $3 ORDER BY created_at DESC LIMIT 1`,
          [topic, schemaRef, `case_${caseId}`],
        );
        if (rows[0]) { capturedEnvelope = rows[0].envelope; return true; }
        return false;
      },
      `shared.outbox with topic=${topic} schema_ref=${schemaRef} for case ${caseId}`,
      10_000,
    );
    _lastOutboxEnvelope = capturedEnvelope;
  },
);

Then(
  'the outbox envelope payload field {string} equals {string}',
  async function (this: SimWorld, field: string, expected: string) {
    if (!_lastOutboxEnvelope) throw new Error('No outbox row captured — run the outbox existence step first');
    const payload = (_lastOutboxEnvelope['payload'] ?? {}) as Record<string, unknown>;
    assert.equal(String(payload[field] ?? ''), expected, `envelope.payload.${field} expected "${expected}", got "${String(payload[field])}"`);
  },
);

Then(
  'the outbox envelope does not contain fields {string} or {string} or {string} or {string}',
  async function (this: SimWorld, f1: string, f2: string, f3: string, f4: string) {
    if (!_lastOutboxEnvelope) throw new Error('No outbox row captured');
    const payload = (_lastOutboxEnvelope['payload'] ?? {}) as Record<string, unknown>;
    for (const field of [f1, f2, f3, f4]) {
      assert.ok(!Object.prototype.hasOwnProperty.call(payload, field), `PHI safety: outbox payload contains forbidden field "${field}"`);
    }
  },
);

// ---------------------------------------------------------------------------
// Scenario 2: RFI issuance
// ---------------------------------------------------------------------------

Given(
  'a PA case {string} is seeded for tenant {string} via intake',
  async function (this: SimWorld, caseLabel: string, tenantId: string) {
    const intakeUrl = SERVICE_BASE['enstellarIntake'] ?? 'http://localhost:3003';
    const body = {
      channel: 'PAS',
      caseRef: null,
      rawPayloadRef: `raw:${Buffer.from(`synthetic-${caseLabel}`).toString('base64')}`,
      receivedAt: new Date().toISOString(),
      memberRef: 'Patient/m_synth_ma_001',
      coverageRef: 'Coverage/cov-synth-001',
      providers: { requestingNpi: 'npi_requesting_001' },
      serviceLines: [{ code: '27447', system: 'http://www.ama-assn.org/go/cpt', qty: 1 }],
      urgency: 'standard',
      externalIds: [{ system: 'https://simintero.io/test', value: caseLabel }],
    };
    const res = await fetch(`${intakeUrl}/internal/intake/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-tenant-id': tenantId },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Intake failed: ${res.status} ${await res.text()}`);
    const result = await res.json() as { caseId: string };
    this.capture(caseLabel, result.caseId);
    this.capture('last_case_id', result.caseId);
  },
);

Given(
  'the PaWorkflow {string} is started for case {string} tenant {string} urgency {string}',
  async function (this: SimWorld, rawWorkflowId: string, rawCaseId: string, tenantId: string, urgency: string) {
    const workflowId = resolveVars(rawWorkflowId, this.vars);
    const caseId     = resolveVars(rawCaseId, this.vars);
    const client = await getTemporalClient();
    await client.workflow.start('PaWorkflow', {
      taskQueue: 'pa-workflow',
      workflowId,
      args: [{ caseId, tenantId, urgency }],
    });
  },
);

Then(
  'an ens.rfi row exists for case {string} with status {string} within {int} seconds',
  async function (this: SimWorld, rawCaseId: string, expectedStatus: string, timeoutSeconds: number) {
    const caseId = resolveVars(rawCaseId, this.vars);
    let capturedRfiId: string | null = null;
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ rfi_id: string }>(
          `SELECT rfi_id FROM ens.rfi WHERE case_id = $1::uuid AND status = $2 LIMIT 1`,
          [caseId, expectedStatus],
        );
        if (rows[0]) { capturedRfiId = rows[0].rfi_id; return true; }
        return false;
      },
      `ens.rfi for case ${caseId} with status=${expectedStatus}`,
      timeoutSeconds * 1000,
    );
    this.capture('last_rfi_id', capturedRfiId!);
  },
);

Then(
  'the rfi_id is captured as {string}',
  async function (this: SimWorld, varName: string) {
    const rfiId = this.vars.get('last_rfi_id') as string | undefined;
    if (!rfiId) throw new Error('No rfi_id captured');
    this.capture(varName, rfiId);
  },
);

When(
  'the RFI {string} for case {string} is satisfied via signal',
  async function (this: SimWorld, rawRfiId: string, rawCaseId: string) {
    const rfiId      = resolveVars(rawRfiId, this.vars);
    const caseId     = resolveVars(rawCaseId, this.vars);
    const workflowId = `pa-workflow-${caseId}`;
    await signalWorkflow(workflowId, 'rfi_satisfied', { rfiId });
  },
);

Then(
  'the ens.rfi row for {string} has status {string} within {int} seconds',
  async function (this: SimWorld, rawRfiId: string, expectedStatus: string, timeoutSeconds: number) {
    const rfiId = resolveVars(rawRfiId, this.vars);
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ status: string }>(
          `SELECT status FROM ens.rfi WHERE rfi_id = $1 AND status = $2 LIMIT 1`,
          [rfiId, expectedStatus],
        );
        return rows.length > 0;
      },
      `ens.rfi ${rfiId} to have status=${expectedStatus}`,
      timeoutSeconds * 1000,
    );
  },
);

// ---------------------------------------------------------------------------
// Scenario 3: Withdrawal
// ---------------------------------------------------------------------------

Given(
  'a PA case {string} is seeded for tenant {string} in state {string}',
  async function (this: SimWorld, caseLabel: string, tenantId: string, targetState: string) {
    const intakeUrl = SERVICE_BASE['enstellarIntake'] ?? 'http://localhost:3003';
    const res = await fetch(`${intakeUrl}/internal/intake/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-tenant-id': tenantId },
      body: JSON.stringify({
        channel: 'PAS',
        caseRef: null,
        rawPayloadRef: `raw:${Buffer.from(`synthetic-${caseLabel}-withdrawal`).toString('base64')}`,
        receivedAt: new Date().toISOString(),
        memberRef: 'Patient/m_synth_ma_001',
        coverageRef: 'Coverage/cov-synth-001',
        providers: { requestingNpi: 'npi_requesting_001' },
        serviceLines: [{ code: '27447', system: 'http://www.ama-assn.org/go/cpt', qty: 1 }],
        urgency: 'standard',
        externalIds: [{ system: 'https://simintero.io/test', value: caseLabel }],
      }),
    });
    if (!res.ok) throw new Error(`Intake failed: ${res.status} ${await res.text()}`);
    const { caseId } = await res.json() as { caseId: string };
    this.capture(caseLabel, caseId);
    this.capture('last_case_id', caseId);

    const workflowId = `pa-workflow-${caseId}`;
    const client = await getTemporalClient();
    await client.workflow.start('PaWorkflow', {
      taskQueue: 'pa-workflow',
      workflowId,
      args: [{ caseId, tenantId, urgency: 'standard' }],
    });

    await pollUntil(
      async () => (await queryWorkflowState(workflowId)) === targetState,
      `PaWorkflow ${workflowId} to reach state ${targetState}`,
      60_000,
    );
  },
);

When(
  'the PA workflow {string} is withdrawn with reason {string}',
  async function (this: SimWorld, rawWorkflowId: string, reason: string) {
    const workflowId = resolveVars(rawWorkflowId, this.vars);
    await signalWorkflow(workflowId, 'withdraw', { reason });
  },
);

Then(
  'the ens.case row for case {string} has state {string} within {int} seconds',
  async function (this: SimWorld, rawCaseId: string, expectedState: string, timeoutSeconds: number) {
    const caseId = resolveVars(rawCaseId, this.vars);
    await pollUntil(
      async () => {
        const { rows } = await this.dbQuery<{ state: string }>(
          `SELECT state FROM ens.case WHERE case_id = $1::uuid AND state = $2 LIMIT 1`,
          [caseId, expectedState],
        );
        return rows.length > 0;
      },
      `ens.case ${caseId} to have state=${expectedState}`,
      timeoutSeconds * 1000,
    );
  },
);
