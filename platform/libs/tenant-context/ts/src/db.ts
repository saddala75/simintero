import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ctx } from "./index.js";

interface TenantDb {
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
}

export function createTenantDb(pool: Pool): TenantDb {
  return {
    async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const tenantCtx = ctx();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('sim.tenant_id', $1, true)",
          [tenantCtx.tenant_id]
        );
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      return this.transaction(async (client) => {
        const result = await client.query<T>(sql, params);
        return result.rows;
      });
    },
  };
}
