import { describe, it, expect } from 'vitest';
import { evaluateGuard } from '../guards/CelGuardEvaluator.js';

describe('CelGuardEvaluator', () => {
  describe('boolean guards', () => {
    it('evaluates entitlement guard true when DIG enabled', () => {
      const ctx = { entitlement: { module: { DIG: { enabled: true } } } };
      expect(evaluateGuard('entitlement.module.DIG.enabled == true', ctx)).toBe(true);
    });

    it('evaluates entitlement guard false when DIG disabled', () => {
      const ctx = { entitlement: { module: { DIG: { enabled: false } } } };
      expect(evaluateGuard('entitlement.module.DIG.enabled == true', ctx)).toBe(false);
    });

    it('evaluates == false correctly', () => {
      const ctx = { feature: { active: false } };
      expect(evaluateGuard('feature.active == false', ctx)).toBe(true);
    });

    it('returns false when path does not exist', () => {
      const ctx = {};
      expect(evaluateGuard('entitlement.module.DIG.enabled == true', ctx)).toBe(false);
    });
  });

  describe('string equality', () => {
    it('evaluates double-quoted string equality', () => {
      expect(
        evaluateGuard('case.urgency == "expedited"', { case: { urgency: 'expedited' } }),
      ).toBe(true);
    });

    it('evaluates single-quoted string equality', () => {
      expect(
        evaluateGuard("case.urgency == 'standard'", { case: { urgency: 'standard' } }),
      ).toBe(true);
    });

    it('returns false on string mismatch', () => {
      expect(
        evaluateGuard('case.urgency == "expedited"', { case: { urgency: 'standard' } }),
      ).toBe(false);
    });
  });

  describe('numeric equality', () => {
    it('evaluates numeric equality', () => {
      expect(evaluateGuard('priority.level == 3', { priority: { level: 3 } })).toBe(true);
    });

    it('returns false on numeric mismatch', () => {
      expect(evaluateGuard('priority.level == 3', { priority: { level: 2 } })).toBe(false);
    });
  });

  describe('error cases', () => {
    it('throws on unsupported expression (!=)', () => {
      expect(() =>
        evaluateGuard('case.urgency != "expedited"', { case: { urgency: 'expedited' } }),
      ).toThrow('Unsupported CEL expression');
    });

    it('throws on unsupported expression (no operator)', () => {
      expect(() => evaluateGuard('case.urgency', {})).toThrow('Unsupported CEL expression');
    });

    it('throws on greater-than expression', () => {
      expect(() => evaluateGuard('priority.level > 2', {})).toThrow('Unsupported CEL expression');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      const ctx = { entitlement: { module: { DIG: { enabled: true } } } };
      expect(evaluateGuard('  entitlement.module.DIG.enabled == true  ', ctx)).toBe(true);
    });
  });
});
