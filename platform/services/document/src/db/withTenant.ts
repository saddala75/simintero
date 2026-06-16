import type { Pool, PoolClient } from 'pg';

/**
 * Run `fn` on a single connection with `sim.tenant_id` set transaction-locally,
 * so RLS policies (`tenant_id = current_setting('sim.tenant_id', true)`) apply to
 * every statement `fn` issues. Commits on success, rolls back on error, always releases.
 */
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
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
