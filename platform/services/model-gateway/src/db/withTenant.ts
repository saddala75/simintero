import type { Pool, PoolClient } from 'pg';

/** Run `fn` on one connection with `sim.tenant_id` set transaction-locally (RLS). */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    let destroy = false;
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    client.release(destroy);
    throw err;
  }
}
