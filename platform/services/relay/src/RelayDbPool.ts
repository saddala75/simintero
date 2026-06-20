import type pg from 'pg';
import type { RelayDb, DbClient } from '@sim/outbox-ts';

export function relayDb(pool: pg.Pool): RelayDb {
  return {
    async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client as unknown as DbClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
