import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRulesRouter } from '../routes/rules.js';
import type {
  RulesCompiler,
  RulesVkasClient,
  RulesGovernanceClient,
} from '../routes/rules.js';

const FAKE_ELM = {
  library: {
    statements: { def: [] },
    identifier: { id: 'TestLib', version: '1.0.0' },
  },
};

interface CompilerCall {
  cql: string;
}
interface CreateCall {
  input: Record<string, unknown>;
}
interface SubmitCall {
  canonical_url: string;
  version: string;
}
interface EnqueueCall {
  body: Record<string, unknown>;
}

let compilerCalls: CompilerCall[];
let createCalls: CreateCall[];
let submitCalls: SubmitCall[];
let enqueueCalls: EnqueueCall[];
let compilerShouldFail: boolean;

const compiler: RulesCompiler = {
  async compile(cql: string) {
    compilerCalls.push({ cql });
    if (compilerShouldFail) {
      const err = new Error('CQL compilation failed') as Error & {
        errors: string[];
      };
      err.errors = ['syntax error'];
      throw err;
    }
    return FAKE_ELM;
  },
};

const vkas: RulesVkasClient = {
  async create(input: Record<string, unknown>) {
    createCalls.push({ input });
    return {
      artifact_id: input['canonical_url'] as string,
      version: '1.0.0',
    };
  },
  async submit(canonical_url: string, version: string) {
    submitCalls.push({ canonical_url, version });
    return { canonical_url, version, status: 'in_review' };
  },
};

const governance: RulesGovernanceClient = {
  async enqueue(body: Record<string, unknown>) {
    enqueueCalls.push({ body });
    return { enqueued: true };
  },
};

let server: Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use(createRulesRouter({ compiler, vkas, governance }));
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })
);

beforeEach(() => {
  compilerCalls = [];
  createCalls = [];
  submitCalls = [];
  enqueueCalls = [];
  compilerShouldFail = false;
});

async function postRule(body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/v1/authoring/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json();
  return { status: res.status, data };
}

const VALID_BODY = {
  procedure_code: '12345',
  slug: 'my-rule',
  cql: 'define X: true',
  pa_required: true,
  pins: { codesystem: 'http://snomed.info/sct' },
  dtr_package_ref: 'https://dtr.example/pkg',
  evidence_requirements: [{ requirement_id: 'X' }],
  created_by: 'author@example.com',
};

const CQL_LIBRARY_URL = 'https://artifacts.simintero.io/shared/cql_library/my-rule';
const COVERAGE_RULE_URL =
  'https://artifacts.simintero.io/shared/coverage_rule/12345';

describe('POST /v1/authoring/rules', () => {
  it('orchestrates compile -> create x2 -> submit x2 -> enqueue and returns 201', async () => {
    const { status, data } = await postRule(VALID_BODY);

    expect(status).toBe(201);

    // compiler called once with cql
    expect(compilerCalls).toHaveLength(1);
    expect(compilerCalls[0]!.cql).toBe(VALID_BODY.cql);

    // vkas.create called twice
    expect(createCalls).toHaveLength(2);

    const cqlLibInput = createCalls[0]!.input;
    expect(cqlLibInput['canonical_url']).toBe(CQL_LIBRARY_URL);
    expect(cqlLibInput['artifact_type']).toBe('cql_library');
    expect(cqlLibInput['content']).toEqual({
      cql: VALID_BODY.cql,
      elm: FAKE_ELM,
    });
    expect(cqlLibInput['created_by']).toBe(VALID_BODY.created_by);

    const coverageInput = createCalls[1]!.input;
    expect(coverageInput['canonical_url']).toBe(COVERAGE_RULE_URL);
    expect(coverageInput['artifact_type']).toBe('coverage_rule');
    expect(coverageInput['content']).toEqual({
      procedure_codes: ['12345'],
      pa_required: true,
      pins: VALID_BODY.pins,
      dtr_package_ref: VALID_BODY.dtr_package_ref,
      evidence_requirements: VALID_BODY.evidence_requirements,
      elm_ref: CQL_LIBRARY_URL,
      elm_version: '1.0.0',
    });
    expect(coverageInput['created_by']).toBe(VALID_BODY.created_by);

    // vkas.submit called twice (both canonical urls, version 1.0.0)
    expect(submitCalls).toHaveLength(2);
    const submittedUrls = submitCalls.map((c) => c.canonical_url);
    expect(submittedUrls).toContain(CQL_LIBRARY_URL);
    expect(submittedUrls).toContain(COVERAGE_RULE_URL);
    for (const c of submitCalls) {
      expect(c.version).toBe('1.0.0');
    }

    // governance.enqueue called once
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]!.body).toEqual({
      artifact_id: COVERAGE_RULE_URL,
      cql_library_url: CQL_LIBRARY_URL,
      version: '1.0.0',
      created_by: VALID_BODY.created_by,
    });

    // response shape
    expect(data).toEqual({
      rule_id: COVERAGE_RULE_URL,
      cql_library_url: CQL_LIBRARY_URL,
      version: '1.0.0',
      status: 'in_review',
    });
  });

  it('returns 400 when a required field is missing', async () => {
    const { status } = await postRule({ ...VALID_BODY, procedure_code: undefined });
    expect(status).toBe(400);
    expect(compilerCalls).toHaveLength(0);
  });

  it('returns 400 when compile fails', async () => {
    compilerShouldFail = true;
    const { status } = await postRule(VALID_BODY);
    expect(status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });
});
