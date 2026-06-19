import { describe, it, expect, vi } from 'vitest';
import { withTenant } from '../db/withTenant.js';

function fakeClient() {
  const calls: string[] = [];
  return {
    calls,
    query: vi.fn(async (q: string) => { calls.push(q); return { rows: [] }; }),
    release: vi.fn(),
  };
}

describe('withTenant', () => {
  it('wraps fn in BEGIN + set_config + COMMIT and releases', async () => {
    const client = fakeClient();
    const pool = { connect: vi.fn(async () => client) } as any;
    const result = await withTenant(pool, 't_one', async (c) => { await c.query('SELECT 1'); return 42; });
    expect(result).toBe(42);
    expect(client.calls[0]).toBe('BEGIN');
    expect(client.calls[1]).toContain("set_config('sim.tenant_id'");
    expect(client.calls).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back on error', async () => {
    const client = fakeClient();
    const pool = { connect: vi.fn(async () => client) } as any;
    await expect(withTenant(pool, 't_one', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
