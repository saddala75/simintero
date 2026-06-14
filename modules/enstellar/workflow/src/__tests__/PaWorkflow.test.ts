/**
 * PaWorkflow tests — no Temporal server required.
 *
 * Strategy:
 *  1. State-machine logic is tested via advanceState() — pure TypeScript.
 *  2. Activity guards tested by calling activity functions directly.
 *  3. CEL guard integration tested via evaluateGuard + advanceState routing.
 *
 * Tests do NOT import @temporalio/* — they exercise the pure business logic
 * extracted into PaWorkflowState.ts and the activities.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  advanceState,
  isTerminal,
  type PaWorkflowState,
  type PaWorkflowStatus,
} from '../workflows/PaWorkflowState.js';
import { evaluateGuard } from '../guards/CelGuardEvaluator.js';
import { recordAutoDetermination } from '../activities/recordAutoDetermination.js';
import { callRuntimeEvaluate } from '../activities/callRuntimeEvaluate.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------------

describe('PaWorkflow state machine', () => {
  it('advances from intake to completeness_check on case.created', () => {
    expect(advanceState('intake', 'case.created')).toBe('completeness_check');
  });

  it('routes to pend_rfi on completeness.gap_found', () => {
    expect(advanceState('completeness_check', 'completeness.gap_found')).toBe('pend_rfi');
  });

  it('routes to clinical_review on completeness.complete', () => {
    expect(advanceState('completeness_check', 'completeness.complete')).toBe('clinical_review');
  });

  it('advances pend_rfi to clinical_review on rfi.satisfied', () => {
    expect(advanceState('pend_rfi', 'rfi.satisfied')).toBe('clinical_review');
  });

  it('advances pend_rfi to determined on rfi.deadline_expired', () => {
    expect(advanceState('pend_rfi', 'rfi.deadline_expired')).toBe('determined');
  });

  it('advances clinical_review to determined on decision.recorded', () => {
    expect(advanceState('clinical_review', 'decision.recorded')).toBe('determined');
  });

  it('allows withdrawal from intake', () => {
    expect(advanceState('intake', 'member.withdrawal')).toBe('withdrawn');
  });

  it('allows withdrawal from completeness_check', () => {
    expect(advanceState('completeness_check', 'member.withdrawal')).toBe('withdrawn');
  });

  it('allows withdrawal from pend_rfi', () => {
    expect(advanceState('pend_rfi', 'member.withdrawal')).toBe('withdrawn');
  });

  it('allows withdrawal from clinical_review', () => {
    expect(advanceState('clinical_review', 'member.withdrawal')).toBe('withdrawn');
  });

  it('blocks withdrawal from terminal state: determined', () => {
    expect(advanceState('determined', 'member.withdrawal')).toBeNull();
  });

  it('blocks withdrawal from terminal state: withdrawn', () => {
    expect(advanceState('withdrawn', 'member.withdrawal')).toBeNull();
  });

  it('blocks withdrawal from terminal state: voided', () => {
    expect(advanceState('voided', 'member.withdrawal')).toBeNull();
  });

  it('voids from intake on duplicate_detected', () => {
    expect(advanceState('intake', 'case.duplicate_detected')).toBe('voided');
  });

  it('voids from completeness_check on duplicate_detected', () => {
    expect(advanceState('completeness_check', 'case.duplicate_detected')).toBe('voided');
  });

  it('cannot void from clinical_review (past early stages)', () => {
    expect(advanceState('clinical_review', 'case.duplicate_detected')).toBeNull();
  });

  it('returns null for invalid transition (intake + rfi.satisfied)', () => {
    expect(advanceState('intake', 'rfi.satisfied')).toBeNull();
  });

  it('returns null for unknown trigger from terminal state', () => {
    expect(advanceState('determined', 'case.created')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

describe('isTerminal', () => {
  const terminals: PaWorkflowStatus[] = ['determined', 'withdrawn', 'voided'];
  const nonTerminals: PaWorkflowStatus[] = [
    'intake', 'completeness_check', 'pend_rfi', 'clinical_review',
  ];

  for (const s of terminals) {
    it(`${s} is terminal`, () => expect(isTerminal(s)).toBe(true));
  }
  for (const s of nonTerminals) {
    it(`${s} is not terminal`, () => expect(isTerminal(s)).toBe(false));
  }
});

// ---------------------------------------------------------------------------
// recordAutoDetermination guards
// ---------------------------------------------------------------------------

describe('recordAutoDetermination', () => {
  it('throws when eligible is false', async () => {
    await expect(
      recordAutoDetermination({
        caseId: 'c1',
        tenantId: 't1',
        outcome: 'approved',
        eligible: false,
      }),
    ).rejects.toThrow('Auto-determination requires eligible=true from C-1');
  });

  it('throws when outcome is deny', async () => {
    await expect(
      recordAutoDetermination({
        caseId: 'c1',
        tenantId: 't1',
        outcome: 'deny',
        eligible: true,
      }),
    ).rejects.toThrow("Auto-determination only supports outcome 'approved'");
  });

  it('throws when outcome is partial', async () => {
    await expect(
      recordAutoDetermination({
        caseId: 'c1',
        tenantId: 't1',
        outcome: 'partial',
        eligible: true,
      }),
    ).rejects.toThrow("Auto-determination only supports outcome 'approved'");
  });

  it('succeeds when eligible=true and outcome=approved (stub path)', async () => {
    // Service unreachable → stub
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await recordAutoDetermination({
      caseId: 'c1',
      tenantId: 't1',
      outcome: 'approved',
      eligible: true,
    });

    expect(result.determinationId).toMatch(/^det-stub-/);
  });

  it('succeeds when eligible=true and outcome=approved (200 path)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ determination_id: 'det-abc123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await recordAutoDetermination({
      caseId: 'c1',
      tenantId: 't1',
      outcome: 'approved',
      eligible: true,
    });

    expect(result.determinationId).toBe('det-abc123');
  });
});

// ---------------------------------------------------------------------------
// CEL guard integration — drives routing decision
// ---------------------------------------------------------------------------

describe('CEL guard drives completeness routing', () => {
  it('evaluates DIG guard against stub entitlements (enabled)', () => {
    // state.entitlements = { module: { DIG: { enabled: true } } }
    // Workflow wraps it: celContext = { entitlement: state.entitlements }
    const entitlements = { module: { DIG: { enabled: true } } };
    const celContext = { entitlement: entitlements };
    const guardPasses = evaluateGuard('entitlement.module.DIG.enabled == true', celContext);
    // When guard passes, we would call C-1
    expect(guardPasses).toBe(true);
  });

  it('evaluates DIG guard against stub entitlements (disabled)', () => {
    const entitlements = { module: { DIG: { enabled: false } } };
    const celContext = { entitlement: entitlements };
    const guardPasses = evaluateGuard('entitlement.module.DIG.enabled == true', celContext);
    // When guard fails, we skip C-1 and go directly to clinical_review
    expect(guardPasses).toBe(false);
  });

  it('simulates completeness routing: gaps → pend_rfi', () => {
    // When C-1 returns gaps, trigger gap_found
    const gaps = ['missing_auth_letter'];
    const trigger = gaps.length > 0 ? ('completeness.gap_found' as const) : ('completeness.complete' as const);
    expect(advanceState('completeness_check', trigger)).toBe('pend_rfi');
  });

  it('simulates completeness routing: no gaps → clinical_review', () => {
    const gaps: string[] = [];
    const trigger = gaps.length > 0 ? ('completeness.gap_found' as const) : ('completeness.complete' as const);
    expect(advanceState('completeness_check', trigger)).toBe('clinical_review');
  });
});

// ---------------------------------------------------------------------------
// Full pa-standard-ma happy path simulation (no Temporal)
// ---------------------------------------------------------------------------

describe('pa-standard-ma happy path simulation', () => {
  it('drives intake → completeness_check → clinical_review → determined', () => {
    let status: PaWorkflowStatus = 'intake';

    // case.created
    const s1 = advanceState(status, 'case.created');
    expect(s1).toBe('completeness_check');
    status = s1!;

    // completeness.complete (no gaps)
    const s2 = advanceState(status, 'completeness.complete');
    expect(s2).toBe('clinical_review');
    status = s2!;

    // decision.recorded
    const s3 = advanceState(status, 'decision.recorded');
    expect(s3).toBe('determined');
    status = s3!;

    expect(isTerminal(status)).toBe(true);
  });

  it('drives intake → pend_rfi → clinical_review → determined', () => {
    let status: PaWorkflowStatus = 'intake';

    status = advanceState(status, 'case.created')!;
    expect(status).toBe('completeness_check');

    status = advanceState(status, 'completeness.gap_found')!;
    expect(status).toBe('pend_rfi');

    status = advanceState(status, 'rfi.satisfied')!;
    expect(status).toBe('clinical_review');

    status = advanceState(status, 'decision.recorded')!;
    expect(status).toBe('determined');

    expect(isTerminal(status)).toBe(true);
  });

  it('drives pend_rfi → determined (deadline expired)', () => {
    let status: PaWorkflowStatus = 'intake';

    status = advanceState(status, 'case.created')!;
    status = advanceState(status, 'completeness.gap_found')!;

    status = advanceState(status, 'rfi.deadline_expired')!;
    expect(status).toBe('determined');
    expect(isTerminal(status)).toBe(true);
  });

  it('member withdraws during clinical_review', () => {
    let status: PaWorkflowStatus = 'intake';

    status = advanceState(status, 'case.created')!;
    status = advanceState(status, 'completeness.complete')!;
    // clinical_review — member withdraws
    status = advanceState(status, 'member.withdrawal')!;
    expect(status).toBe('withdrawn');
    expect(isTerminal(status)).toBe(true);
  });
});
