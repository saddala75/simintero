import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createUnitTestRouter } from '../routes/unitTest.js';

// Real HTTP test server — no supertest needed (Node 20 global fetch)
let server: Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use(createUnitTestRouter());
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

async function postUnitTest(body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/v1/authoring/unit-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json();
  return { status: res.status, data };
}

describe('POST /v1/authoring/unit-test', () => {
  it('test case with expected_outcome meets_all where all evidence is true returns passed: true', async () => {
    const { status, data } = await postUnitTest({
      library: {
        library: {
          statements: { def: [] },
          identifier: { id: 'TestLib', version: '1.0.0' },
        },
      },
      testCases: [
        {
          test_case_id: 'tc-1',
          evidence: { criterion1: true, criterion2: true },
          expected_outcome: 'meets_all',
        },
      ],
    });

    expect(status).toBe(200);
    const body = data as { results: Array<{ test_case_id: string; passed: boolean; actual_outcome: string; expected_outcome: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.test_case_id).toBe('tc-1');
    expect(body.results[0]!.passed).toBe(true);
    expect(body.results[0]!.actual_outcome).toBe('meets_all');
    expect(body.results[0]!.expected_outcome).toBe('meets_all');
  });

  it('test case with expected_outcome not_met where evidence has false key returns passed: true', async () => {
    const { status, data } = await postUnitTest({
      library: {},
      testCases: [
        {
          test_case_id: 'tc-2',
          evidence: { criterion1: false },
          expected_outcome: 'not_met',
        },
      ],
    });

    expect(status).toBe(200);
    const body = data as { results: Array<{ test_case_id: string; passed: boolean; actual_outcome: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.test_case_id).toBe('tc-2');
    expect(body.results[0]!.passed).toBe(true);
    expect(body.results[0]!.actual_outcome).toBe('not_met');
  });

  it('invalid expected_outcome value returns 400 with invalidCases list', async () => {
    const { status, data } = await postUnitTest({
      library: {},
      testCases: [
        {
          test_case_id: 'tc-bad',
          evidence: { criterion1: true },
          expected_outcome: 'totally_invalid_value',
        },
      ],
    });

    expect(status).toBe(400);
    const body = data as { error: string; invalidCases: string[] };
    expect(body.error).toBe('Invalid expected_outcome');
    expect(body.invalidCases).toContain('tc-bad');
  });

  it('mixed valid test cases — correct prediction of indeterminate outcome', async () => {
    const { status, data } = await postUnitTest({
      library: {},
      testCases: [
        {
          test_case_id: 'tc-indet',
          evidence: { criterion1: 'indeterminate', criterion2: true },
          expected_outcome: 'indeterminate',
        },
      ],
    });

    expect(status).toBe(200);
    const body = data as { results: Array<{ passed: boolean; actual_outcome: string }> };
    expect(body.results[0]!.passed).toBe(true);
    expect(body.results[0]!.actual_outcome).toBe('indeterminate');
  });

  it('returns 400 when testCases is not an array', async () => {
    const { status } = await postUnitTest({ library: {}, testCases: 'not-an-array' });
    expect(status).toBe(400);
  });
});
