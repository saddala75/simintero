import { describe, it, expect, vi } from 'vitest';
import { runEval, type Args, type FetchImpl } from './eval-runner.js';

// A gold set with two triage_advise cases so the approve/deny rates are
// measurable (and a delta can be non-zero).
const GOLD_CASES = [
  {
    id: 'tr-1',
    task_kind: 'triage_advise',
    inputs: {},
    expect: { structural: ['suggestion'], suggestion: 'likely_meets', min_confidence: 0.7 },
  },
  {
    id: 'tr-2',
    task_kind: 'triage_advise',
    inputs: {},
    expect: { structural: ['suggestion'], suggestion: 'likely_meets', min_confidence: 0.7 },
  },
];

const ARGS: Args = {
  binding: 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
  bindingVersion: '1.1.0',
  evalSet: 'https://artifacts.simintero.io/shared/eval_set/claude-pa-gold',
  gateway: 'http://gw',
  vkas: 'http://vkas',
  approver: 'test',
  tenant: 'tenant-dev',
  cell: 'pooled',
};

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// Build a mocked fetch.
//   - :resolve for the eval_set → gold_cases
//   - :resolve for the binding (no version) → the current-active version + content
//   - POST /eval → triage output, keyed by the model_binding_version in the body
//   - POST /v1/approvals → 201, capturing the posted attestation
function makeFetch(opts: {
  activeVersion?: string; // undefined => no active / no version surfaced
  outputsByVersion: Record<string, unknown>;
  noActive?: boolean;
}) {
  const posted: { approval?: Record<string, unknown> } = {};
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes(':resolve') && u.includes('eval_set')) {
      return jsonRes({ status: 'active', content: { gold_cases: GOLD_CASES } });
    }
    if (u.includes(':resolve') && u.includes('model_binding')) {
      if (opts.noActive) return jsonRes({ error: 'none' }, 404);
      // Top-level version surfaced (M-2). content has NO version field.
      return jsonRes({
        status: 'active',
        content: { provider: 'anthropic', model_id: 'm' },
        version: opts.activeVersion,
      });
    }
    if (u.endsWith('/eval')) {
      const body = JSON.parse(String(init?.body)) as { model_binding_version: string };
      const out = opts.outputsByVersion[body.model_binding_version];
      return jsonRes({ output: out });
    }
    if (u.endsWith('/v1/approvals')) {
      posted.approval = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonRes({ ok: true }, 201);
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as FetchImpl;
  return { fetchImpl, posted };
}

const meets = { suggestion: 'likely_meets', confidence: 0.9 };
const denies = { suggestion: 'likely_denies', confidence: 0.9 };

describe('runEval — outcome_delta (M-2: runner feeds computeOutcomeDelta real data)', () => {
  it('candidate and active produce DIFFERENT outputs → non-zero delta written to attestation', async () => {
    // Candidate (1.1.0) → both likely_meets (approve rate 1.0).
    // Active   (1.0.0) → both likely_denies (approve rate 0.0, deny rate 1.0).
    const { fetchImpl, posted } = makeFetch({
      activeVersion: '1.0.0',
      outputsByVersion: { '1.1.0': meets, '1.0.0': denies },
    });
    const result = await runEval(ARGS, fetchImpl);
    expect(result.outcomeDelta.approve_pct_delta).toBe(1); // 1.0 - 0.0
    expect(result.outcomeDelta.deny_pct_delta).toBe(-1); // 0.0 - 1.0
    // The non-zero delta is in the posted attestation.
    const att = (posted.approval as { attestation: { outcome_delta: { approve_pct_delta: number } } }).attestation;
    expect(att.outcome_delta.approve_pct_delta).toBe(1);
    expect(result.decided).toBe('approved'); // candidate passes the gold set
  });

  it('candidate and active produce the SAME outputs → delta {0,0} (CI mock-vs-mock)', async () => {
    const { fetchImpl, posted } = makeFetch({
      activeVersion: '1.0.0',
      outputsByVersion: { '1.1.0': meets, '1.0.0': meets },
    });
    const result = await runEval(ARGS, fetchImpl);
    expect(result.outcomeDelta).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
    const att = (posted.approval as { attestation: { outcome_delta: unknown } }).attestation;
    expect(att.outcome_delta).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
  });

  it('active version equals the candidate version → delta {0,0} + note (no comparison run)', async () => {
    const { fetchImpl } = makeFetch({
      activeVersion: '1.1.0', // same as candidate
      outputsByVersion: { '1.1.0': meets },
    });
    const result = await runEval(ARGS, fetchImpl);
    expect(result.outcomeDelta).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
    expect(result.notes.some((n) => /candidate version/.test(n))).toBe(true);
  });

  it('no current-active binding (404) → delta {0,0} + note', async () => {
    const { fetchImpl } = makeFetch({
      noActive: true,
      outputsByVersion: { '1.1.0': meets },
    });
    const result = await runEval(ARGS, fetchImpl);
    expect(result.outcomeDelta).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
    expect(result.notes.some((n) => /no current-active/.test(n))).toBe(true);
  });

  it('resolve surfaces NO top-level version → delta {0,0} + note (does not read content.version)', async () => {
    const { fetchImpl } = makeFetch({
      activeVersion: undefined, // version not surfaced
      outputsByVersion: { '1.1.0': meets },
    });
    const result = await runEval(ARGS, fetchImpl);
    expect(result.outcomeDelta).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
    expect(result.notes.some((n) => /version unknown/.test(n))).toBe(true);
  });
});
