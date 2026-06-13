import { describe, it, expect, vi } from 'vitest';
import { KillSwitchChecker } from '../KillSwitchChecker.js';
import type { Pool } from 'pg';

function makePool(rows: { key: string; value: { value: boolean } }[]): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
}

describe('KillSwitchChecker', () => {
  it('returns false when no kill-switch entitlements are set', async () => {
    const checker = new KillSwitchChecker(makePool([]));
    expect(await checker.isKilled('t_test')).toBe(false);
  });

  it('returns true when ai.inference.disabled is true', async () => {
    const checker = new KillSwitchChecker(
      makePool([{ key: 'ai.inference.disabled', value: { value: true } }])
    );
    expect(await checker.isKilled('t_test')).toBe(true);
  });

  it('returns true when per-workflow kill-switch matches', async () => {
    const checker = new KillSwitchChecker(
      makePool([{ key: 'ai.workflow.pa-standard.disabled', value: { value: true } }])
    );
    expect(await checker.isKilled('t_test', 'pa-standard')).toBe(true);
  });

  it('returns false when per-workflow kill-switch does NOT match the calling workflow', async () => {
    const checker = new KillSwitchChecker(
      makePool([{ key: 'ai.workflow.appeals.disabled', value: { value: true } }])
    );
    expect(await checker.isKilled('t_test', 'pa-standard')).toBe(false);
  });

  it('caches entitlements within TTL and does not re-query', async () => {
    const pool = makePool([]);
    const checker = new KillSwitchChecker(pool);
    await checker.isKilled('t_test');
    await checker.isKilled('t_test');
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('re-queries after invalidate()', async () => {
    const pool = makePool([]);
    const checker = new KillSwitchChecker(pool);
    await checker.isKilled('t_test');
    checker.invalidate('t_test');
    await checker.isKilled('t_test');
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
