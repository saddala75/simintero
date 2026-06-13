import { Router, type Request, type Response } from "express";
import { SimError } from "../errors.js";
import type { CtrlDb, CtrlClient } from "../db/index.js";
import type { TenantEventPublisher } from "../events/TenantEventPublisher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntitlementRow {
  tenant_id: string;
  key: string;
  value: string;
  expires_at: string | null;
}

// ---------------------------------------------------------------------------
// Business logic — extracted for testability
// ---------------------------------------------------------------------------

/**
 * Upserts a single entitlement for a tenant and appends an EntitlementChanged
 * event to the outbox in the SAME database transaction.
 */
export async function upsertEntitlement(
  db: CtrlDb,
  publisher: TenantEventPublisher,
  tenantId: string,
  key: string,
  value: string,
  expiresAt: string | null,
): Promise<EntitlementRow> {
  let updated: EntitlementRow | undefined;

  await db.transaction(async (client: CtrlClient) => {
    const result = await client.query<EntitlementRow>(
      `INSERT INTO ctrl.entitlement (tenant_id, key, value, expires_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET value      = EXCLUDED.value,
             expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [tenantId, key, JSON.stringify(value), expiresAt],
    );

    updated = result.rows[0];
    if (!updated) throw new Error("Entitlement upsert returned no rows");

    await publisher.publishInTransaction(
      client,
      "sim.tenant.admin/EntitlementChanged/v1",
      tenantId,
      { tenant_id: tenantId, key, value, expires_at: expiresAt },
    );
  });

  if (!updated) throw new Error("Transaction produced no result");
  return updated;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

function handleError(err: unknown, res: Response): void {
  if (err instanceof SimError) {
    res.status(err.status).json({ code: err.code, error: err.message });
  } else {
    res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
  }
}

export function createEntitlementsRouter(
  db: CtrlDb,
  publisher: TenantEventPublisher,
): Router {
  const router = Router({ mergeParams: true });

  // GET /v1/tenants/:id/entitlements
  router.get("/", async (req: Request, res: Response) => {
    try {
      const tenantId = req.params["id"];
      if (!tenantId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing tenant id" });
        return;
      }
      const rows = await db.query<EntitlementRow>(
        "SELECT * FROM ctrl.entitlement WHERE tenant_id = $1 ORDER BY key",
        [tenantId],
      );
      res.json({ entitlements: rows });
    } catch (err) {
      handleError(err, res);
    }
  });

  // PATCH /v1/tenants/:id/entitlements
  router.patch("/", async (req: Request, res: Response) => {
    try {
      const tenantId = req.params["id"];
      if (!tenantId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing tenant id" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { key, value, expires_at } = body;

      if (typeof key !== "string" || typeof value !== "string") {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "key and value must be strings" });
        return;
      }

      const expiresAt = typeof expires_at === "string" ? expires_at : null;
      const result = await upsertEntitlement(db, publisher, tenantId, key, value, expiresAt);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
