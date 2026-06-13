import type { Pool, PoolClient } from "pg";

/**
 * A minimal client interface used inside ctrl-db transactions.
 * Mirrors the pattern from @sim/outbox-ts DbClient but typed for ctrl schema.
 */
export interface CtrlClient {
  // No upper-bound constraint so concrete row types (CellRow, TenantRow, …) are accepted directly.
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * ctrl.* schema database handle. No RLS — service-account pool connection.
 * query() runs outside a transaction; transaction() provides a PoolClient
 * that has begun but not committed.
 */
export interface CtrlDb {
  transaction<T>(fn: (client: CtrlClient) => Promise<T>): Promise<T>;
  // No upper-bound constraint so concrete row types work without index signatures.
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

export function createCtrlDb(pool: Pool): CtrlDb {
  return {
    async transaction<T>(fn: (client: CtrlClient) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      let released = false;
      try {
        await client.query("BEGIN");
        const result = await fn(client as CtrlClient);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        let destroy = false;
        try {
          await client.query("ROLLBACK");
        } catch {
          destroy = true;
        }
        client.release(destroy);
        released = true;
        throw err;
      } finally {
        if (!released) client.release();
      }
    },

    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      const client: PoolClient = await pool.connect();
      try {
        // pg's QueryResult<T> requires T extends QueryResultRow; cast via unknown.
        const result = await client.query(sql, params);
        return result.rows as T[];
      } finally {
        client.release();
      }
    },
  };
}
