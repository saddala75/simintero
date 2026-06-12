export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface TenantDb {
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}

/**
 * RelayDb requires a service/admin connection — NOT a tenant-scoped TenantDb.
 * The relay reads from shared.outbox across all tenants; passing a tenant-scoped
 * db here will scope the SELECT to a single tenant's context.
 */
export interface RelayDb {
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}
