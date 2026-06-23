import { describe, it, expect, vi } from 'vitest';
import {
  evaluateBlastRadius,
  applyPromotion,
  type PromotionSet,
  type DiffItem,
} from './promotions.js';
import type { PathDiff } from './diff.js';

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

  it('returns passed=false when the eval gate decided != approved (rejected)', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          gate: 'eval',
          decided: 'rejected',
          attestation: { outcome_delta: { approve_pct_delta: 0, deny_pct_delta: 0 } },
        }],
      }),
    } as unknown as import('pg').Pool;

    const result = await evaluateBlastRadius(PROMOTION_SET, pool);
    expect(result.passed).toBe(false);
    expect(result.items[0]!.passed).toBe(false);
    expect(result.items[0]!.blocked_reason).toContain('eval_rejected');
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
    // Query sequence (post-Task-5):
    //   1. SELECT prior active content
    //   2. SELECT new version content
    //   3. UPDATE artifact to active
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ content: { clinical_criteria: 'v3' } }] })  // prior active
        .mockResolvedValueOnce({ rows: [{ content: { clinical_criteria: 'v3' } }] })  // new version (same → no diff)
        .mockResolvedValueOnce({ rows: [] }),                                           // UPDATE
    } as unknown as import('pg').Pool;

    const diff = await applyPromotion(PROMOTION_SET, pool);
    expect(diff).toHaveLength(1);
    expect(diff[0]!.canonical_url).toContain('knee-arthroscopy');
  });

  it('returns has_content_diff=true and non-empty changes when new content differs from prior active', async () => {
    const priorContent = { clinical_criteria: 'v3', age_min: 18 };
    const newContent   = { clinical_criteria: 'v4', age_min: 18 };

    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ content: priorContent }] })  // SELECT prior active
        .mockResolvedValueOnce({ rows: [{ content: newContent }] })    // SELECT new version
        .mockResolvedValueOnce({ rows: [] }),                           // UPDATE
    } as unknown as import('pg').Pool;

    const diff = await applyPromotion(PROMOTION_SET, pool);
    const item = diff[0] as DiffItem;

    expect(item.has_content_diff).toBe(true);
    expect(item.changes).toBeDefined();
    expect((item.changes as PathDiff[]).length).toBeGreaterThan(0);

    const changes = item.changes as PathDiff[];
    const criteriaChange = changes.find(c => c.path === '/clinical_criteria');
    expect(criteriaChange).toBeDefined();
    expect(criteriaChange!.op).toBe('replace');
    expect(criteriaChange!.before).toBe('v3');
    expect(criteriaChange!.after).toBe('v4');
  });

  it('returns has_content_diff=false and changes=[] when no prior active exists', async () => {
    const newContent = { clinical_criteria: 'v1' };

    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                         // SELECT prior active → empty
        .mockResolvedValueOnce({ rows: [{ content: newContent }] }) // SELECT new version
        .mockResolvedValueOnce({ rows: [] }),                        // UPDATE
    } as unknown as import('pg').Pool;

    const diff = await applyPromotion(PROMOTION_SET, pool);
    const item = diff[0] as DiffItem;

    expect(item.has_content_diff).toBe(false);
    expect(item.changes).toEqual([]);
  });
});
