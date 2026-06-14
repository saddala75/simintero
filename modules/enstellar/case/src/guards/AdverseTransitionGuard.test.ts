import { describe, it, expect } from 'vitest';
import {
  adverseTransitionGuard,
  TransitionGuardError,
  ADVERSE_STATES,
} from './AdverseTransitionGuard.js';

describe('AdverseTransitionGuard', () => {
  it('passes for non-adverse transition', () => {
    expect(() => adverseTransitionGuard('clinical_review', false)).not.toThrow();
    expect(() => adverseTransitionGuard('determined', false)).not.toThrow();
    expect(() => adverseTransitionGuard('withdrawn', false)).not.toThrow();
  });

  it('passes for adverse transition with human signoff', () => {
    expect(() => adverseTransitionGuard('denied', true)).not.toThrow();
    expect(() => adverseTransitionGuard('partially_denied', true)).not.toThrow();
    expect(() => adverseTransitionGuard('adverse_modification', true)).not.toThrow();
  });

  // INVARIANT #1 PROOF — mirror of Python test_engine_denied_without_signoff_raises_guard_error
  it('INVARIANT #1 — denied without signoff throws TransitionGuardError', () => {
    expect(() => adverseTransitionGuard('denied', false)).toThrow(TransitionGuardError);
  });

  it('INVARIANT #1 — partially_denied without signoff throws TransitionGuardError', () => {
    expect(() => adverseTransitionGuard('partially_denied', false)).toThrow(TransitionGuardError);
  });

  it('INVARIANT #1 — adverse_modification without signoff throws TransitionGuardError', () => {
    expect(() => adverseTransitionGuard('adverse_modification', false)).toThrow(TransitionGuardError);
  });

  it('TransitionGuardError carries code SIM-GUARD-0001 and status 403', () => {
    let caught: unknown;
    try { adverseTransitionGuard('denied', false); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(TransitionGuardError);
    expect((caught as TransitionGuardError).code).toBe('SIM-GUARD-0001');
    expect((caught as TransitionGuardError).status).toBe(403);
  });

  it('ADVERSE_STATES set contains exactly three entries', () => {
    expect(ADVERSE_STATES).toEqual(
      new Set(['denied', 'partially_denied', 'adverse_modification'])
    );
  });
});
