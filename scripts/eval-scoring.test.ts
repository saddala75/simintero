import { describe, it, expect } from 'vitest';
import { scoreCase, computeOutcomeDelta, type GoldCase } from './eval-scoring.js';

// --- extract_entities ---------------------------------------------------------
const eeCase: GoldCase = {
  id: 'ee-1',
  task_kind: 'extract_entities',
  inputs: { document_span_refs: ['span-1'] },
  expect: { structural: ['entities'], entity_resource_type: 'Condition' },
};

describe('scoreCase: extract_entities', () => {
  it('passes when entities present and resource_type matches', () => {
    const out = { entities: [{ resource_type: 'Condition', raw_text: 'x', span_ref: 'span-1' }] };
    const r = scoreCase(eeCase, out);
    expect(r.passed).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails structurally when the entities key is missing', () => {
    const r = scoreCase(eeCase, { foo: 1 });
    expect(r.passed).toBe(false);
    const structural = r.checks.find((c) => c.name === 'structural:entities');
    expect(structural?.passed).toBe(false);
  });

  it('fails on a wrong resource_type (key-field)', () => {
    const out = { entities: [{ resource_type: 'Observation' }] };
    const r = scoreCase(eeCase, out);
    expect(r.passed).toBe(false);
    const kf = r.checks.find((c) => c.name === 'entity_resource_type');
    expect(kf?.passed).toBe(false);
  });
});

// --- summarize ----------------------------------------------------------------
const sumCase: GoldCase = {
  id: 'sum-1',
  task_kind: 'summarize',
  inputs: { document_span_refs: ['span-1'] },
  expect: { structural: ['assertions'], must_cite: true },
};

describe('scoreCase: summarize', () => {
  it('passes when an assertion cites a ref in document_span_refs', () => {
    const out = {
      assertions: [
        {
          id: 'a1',
          text: 't',
          confidence: 0.9,
          citations: [{ document_ref: 'span-1', page: 1, region: [0, 0, 0, 0], excerpt_hash: 'h1' }],
        },
      ],
    };
    const r = scoreCase(sumCase, out);
    expect(r.passed).toBe(true);
  });

  it('fails when an assertion has empty citations', () => {
    const out = { assertions: [{ id: 'a1', text: 't', confidence: 0.9, citations: [] }] };
    const r = scoreCase(sumCase, out);
    expect(r.passed).toBe(false);
    const cite = r.checks.find((c) => c.name === 'must_cite');
    expect(cite?.passed).toBe(false);
  });

  it('fails when a citation references an unknown span (does not resolve)', () => {
    const out = {
      assertions: [
        { id: 'a1', text: 't', confidence: 0.9, citations: [{ document_ref: 'unknown-span', page: 1 }] },
      ],
    };
    const r = scoreCase(sumCase, out);
    expect(r.passed).toBe(false);
    const cite = r.checks.find((c) => c.name === 'must_cite');
    expect(cite?.passed).toBe(false);
  });
});

// --- triage_advise ------------------------------------------------------------
const triCase: GoldCase = {
  id: 'tri-1',
  task_kind: 'triage_advise',
  inputs: { requirement_gap_refs: ['gap-1'] },
  expect: { structural: ['suggestion', 'confidence'], suggestion: 'likely_meets', min_confidence: 0.7 },
};

describe('scoreCase: triage_advise', () => {
  it('passes when suggestion matches and confidence >= min_confidence', () => {
    const r = scoreCase(triCase, { suggestion: 'likely_meets', confidence: 0.9 });
    expect(r.passed).toBe(true);
  });

  it('fails when confidence is below min_confidence', () => {
    const r = scoreCase(triCase, { suggestion: 'likely_meets', confidence: 0.5 });
    expect(r.passed).toBe(false);
    const mc = r.checks.find((c) => c.name === 'min_confidence');
    expect(mc?.passed).toBe(false);
  });

  it('abstention: expect.abstains requires confidence < 0.7 — passes at 0.5', () => {
    const abstainCase: GoldCase = {
      id: 'abs-1',
      task_kind: 'triage_advise',
      inputs: {},
      expect: { structural: ['suggestion', 'confidence'], abstains: true },
    };
    const pass = scoreCase(abstainCase, { suggestion: 'needs_rfi', confidence: 0.5 });
    expect(pass.passed).toBe(true);
    const fail = scoreCase(abstainCase, { suggestion: 'likely_meets', confidence: 0.9 });
    expect(fail.passed).toBe(false);
    const abs = fail.checks.find((c) => c.name === 'abstains');
    expect(abs?.passed).toBe(false);
  });
});

// --- computeOutcomeDelta ------------------------------------------------------
describe('computeOutcomeDelta', () => {
  it('identical lists → zero deltas', () => {
    const outs = [
      { suggestion: 'likely_meets', confidence: 0.9 },
      { suggestion: 'likely_denies', confidence: 0.8 },
    ];
    expect(computeOutcomeDelta(outs, outs)).toEqual({ approve_pct_delta: 0, deny_pct_delta: 0 });
  });

  it('measures the change in approve/deny rates', () => {
    const candidate = [
      { suggestion: 'likely_meets', confidence: 0.9 },
      { suggestion: 'likely_meets', confidence: 0.9 },
    ];
    const current = [
      { suggestion: 'likely_meets', confidence: 0.9 },
      { suggestion: 'likely_denies', confidence: 0.9 },
    ];
    // candidate approve rate 1.0 vs current 0.5 → +0.5; deny 0.0 vs 0.5 → -0.5
    const d = computeOutcomeDelta(candidate, current);
    expect(d.approve_pct_delta).toBeCloseTo(0.5);
    expect(d.deny_pct_delta).toBeCloseTo(-0.5);
  });

  it('ignores non-triage outputs and tolerates empty current', () => {
    const candidate = [{ entities: [] }, { suggestion: 'likely_meets', confidence: 0.9 }];
    expect(computeOutcomeDelta(candidate, [])).toEqual({ approve_pct_delta: 1, deny_pct_delta: 0 });
  });
});
