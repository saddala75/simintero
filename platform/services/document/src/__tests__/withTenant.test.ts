import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/withTenant.js';

function makeClient(): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function makePool(client: PoolClient): Pool {
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

describe('withTenant', () => {
  it('sets sim.tenant_id transaction-locally, runs the callback, commits, and releases', async () => {
    const client = makeClient();
    const pool = makePool(client);

    const result = await withTenant(pool, 't_abc', async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('set_config');
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[1]![1]).toEqual(['t_abc']);
    expect(calls).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases when the callback throws', async () => {
    const client = makeClient();
    const pool = makePool(client);

    await expect(
      withTenant(pool, 't_abc', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves the original error and evicts the connection when ROLLBACK also fails', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('rollback failed');
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as import('pg').PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as import('pg').Pool;

    await expect(
      withTenant(pool, 't_abc', async () => { throw new Error('original'); }),
    ).rejects.toThrow('original');

    expect(client.release).toHaveBeenCalledWith(true);
  });
});
