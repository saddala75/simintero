import { describe, it, expect, vi } from 'vitest';
import {
  evaluateBlastRadius,
  applyPromotion,
  type PromotionSet,
} from './promotions.js';

const PROMOTION_SET: PromotionSet = {
  items: [
    { canonical_url: 'https://artifacts.simintero.io/t_test/coverage_rule/knee-arthroscopy', version: '3.2.0' },
  ],
  target_env: 'uat',
  promoted_by: 'u_policy_analyst',
  reason: 'Q3 knee arthroscopy guideline update',
};

describe('evaluateBlastRadius', () => {
  it('returns passed=true when simulation approval exists and delta is within threshold', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          gate: 'eval',
          decided: 'approved',
          attestation: { outcome_delta: { approve_pct_delta: 0.02, deny_pct_delta: -0.01 } },
        }],
      }),
    } as unknown as import('pg').Pool;

    const result = await evaluateBlastRadius(PROMOTION_SET, pool);
    expect(result.passed).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('returns passed=false when outcome delta exceeds threshold', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          gate: 'eval',
          decided: 'approved',
          attestation: { outcome_delta: { approve_pct_delta: 0.25, deny_pct_delta: -0.20 } },
        }],
      }),
    } as unknown as import('pg').Pool;

    const result = await evaluateBlastRadius(PROMOTION_SET, pool);
    expect(result.passed).toBe(false);
    expect(result.items[0]!.blocked_reason).toContain('blast_radius');
  });

  it('returns passed=false when simulation approval is missing', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as import('pg').Pool;

    const result = await evaluateBlastRadius(PROMOTION_SET, pool);
    expect(result.passed).toBe(false);
    expect(result.items[0]!.blocked_reason).toContain('missing_simulation');
  });
});

describe('applyPromotion', () => {
  it('writes promotion changes and returns diff summary', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ content: { clinical_criteria: 'v3' } }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as import('pg').Pool;

    const diff = await applyPromotion(PROMOTION_SET, pool);
    expect(diff).toHaveLength(1);
    expect(diff[0]!.canonical_url).toContain('knee-arthroscopy');
  });
});
