import { AsyncLocalStorage } from "async_hooks";

export type Lob = "MA" | "MEDICAID" | "COMMERCIAL" | "PUBLIC";
export type Tier = "pooled" | "dedicated" | "enclave";
export type PrincipalType = "human" | "service" | "model_agent";

export interface TenantContext {
  readonly tenant_id: string;
  readonly cell_id: string;
  readonly tier: Tier;
  readonly scopes: {
    readonly lob: ReadonlyArray<Lob>;
    readonly region: ReadonlyArray<string>;
    readonly modules: ReadonlyArray<string>;
  };
  readonly roles: ReadonlyArray<string>;
  readonly principal_type: PrincipalType;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function ctx(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      "No tenant context: request reached a context-requiring scope without x-sim-ctx. " +
        "Ensure the tenant-context middleware is applied before this handler."
    );
  }
  return context;
}

export async function withTenantContext<T>(
  context: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(context, fn);
}

export { createContextMiddleware } from "./middleware.js";
export { createTenantDb } from "./db.js";
