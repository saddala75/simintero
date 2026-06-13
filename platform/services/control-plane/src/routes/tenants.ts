import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { SimError } from "../errors.js";
import type { CtrlDb } from "../db/index.js";
import type { CellAssigner } from "../provisioning/CellAssigner.js";
import type { OperationTracker } from "../provisioning/OperationTracker.js";
import type { TenantLifecycle } from "../lifecycle/TenantLifecycle.js";
import type { TenantEventPublisher } from "../events/TenantEventPublisher.js";

// ---------------------------------------------------------------------------
// Guards — exported for unit testing
// ---------------------------------------------------------------------------

const PHI_FIELDS = ["member_id", "dob", "diagnosis"] as const;

export function guardNoPhi(body: Record<string, unknown>): void {
  for (const field of PHI_FIELDS) {
    if (field in body) {
      throw new SimError(
        "SIM-PLAT-PHI",
        400,
        `PHI field '${field}' must not be stored in the ctrl schema`,
      );
    }
  }
}

export function guardTenantIdImmutable(body: Record<string, unknown>): void {
  if ("tenant_id" in body) {
    throw new SimError(
      "SIM-PLAT-0013",
      400,
      "tenant_id is immutable and cannot be set by the caller",
    );
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

interface TenantRow {
  tenant_id: string;
  display: string;
  tier: string;
  env_kind: string;
  env_group: string;
  compliance_baseline: string;
  status: string;
  cell_id: string;
  created_at: string;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof SimError) {
    res.status(err.status).json({ code: err.code, error: err.message });
  } else {
    res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
  }
}

export function createTenantsRouter(
  db: CtrlDb,
  cellAssigner: CellAssigner,
  tracker: OperationTracker,
  publisher: TenantEventPublisher,
  lifecycle: TenantLifecycle,
): Router {
  const router = Router();

  // POST /v1/tenants — provision a new tenant
  router.post("/", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      guardNoPhi(body);

      const { display, tier, env_kind, env_group, region, compliance_baseline } = body;

      if (!display || !tier || !env_kind || !env_group || !region || !compliance_baseline) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing required fields: display, tier, env_kind, env_group, region, compliance_baseline" });
        return;
      }

      const tenantId = `t_${randomUUID()}`;

      // Assign cell — own transaction with advisory lock
      const cellId = await cellAssigner.assignCell(
        tier as "pooled" | "dedicated" | "enclave",
        region as string,
      );

      // Insert tenant + emit event atomically
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO ctrl.tenant
             (tenant_id, display, tier, env_kind, env_group, compliance_baseline, status, cell_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'provisioning', $7)`,
          [tenantId, display, tier, env_kind, env_group, compliance_baseline, cellId],
        );

        await publisher.publishInTransaction(
          client,
          "sim.tenant.admin/TenantProvisioned/v1",
          tenantId,
          {
            tenant_id: tenantId,
            tier,
            env_kind,
            env_group,
            region,
            compliance_baseline,
          },
        );
      });

      const operationId = await tracker.create("provision", tenantId);
      res.status(202).json({ tenant_id: tenantId, operation_id: operationId });
    } catch (err) {
      handleError(err, res);
    }
  });

  // GET /v1/tenants — paginated list
  router.get("/", async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
      const offset = Number(req.query["offset"] ?? 0);
      const rows = await db.query<TenantRow>(
        "SELECT * FROM ctrl.tenant ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
      res.json({ tenants: rows, limit, offset });
    } catch (err) {
      handleError(err, res);
    }
  });

  // GET /v1/tenants/:id
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"];
      if (!id) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing tenant id" });
        return;
      }
      const rows = await db.query<TenantRow>(
        "SELECT * FROM ctrl.tenant WHERE tenant_id = $1",
        [id],
      );
      const tenant = rows[0];
      if (!tenant) {
        res.status(404).json({ code: "SIM-PLAT-0014", error: "Tenant not found" });
        return;
      }
      res.json(tenant);
    } catch (err) {
      handleError(err, res);
    }
  });

  // POST /v1/tenants/:id/suspend
  router.post("/:id/suspend", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"];
      if (!id) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing tenant id" });
        return;
      }

      const rows = await db.query<TenantRow>(
        "SELECT * FROM ctrl.tenant WHERE tenant_id = $1",
        [id],
      );
      const tenant = rows[0];
      if (!tenant) {
        res.status(404).json({ code: "SIM-PLAT-0014", error: "Tenant not found" });
        return;
      }
      lifecycle.guardNotDecommissioned(tenant.status);

      await db.transaction(async (client) => {
        await client.query(
          "UPDATE ctrl.tenant SET status = 'suspended' WHERE tenant_id = $1",
          [id],
        );
        await publisher.publishInTransaction(
          client,
          "sim.tenant.admin/TenantSuspended/v1",
          id,
          { tenant_id: id },
        );
      });

      res.json({ tenant_id: id, status: "suspended" });
    } catch (err) {
      handleError(err, res);
    }
  });

  // POST /v1/tenants/:id/archive
  router.post("/:id/archive", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"];
      if (!id) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing tenant id" });
        return;
      }

      const rows = await db.query<TenantRow>(
        "SELECT * FROM ctrl.tenant WHERE tenant_id = $1",
        [id],
      );
      const tenant = rows[0];
      if (!tenant) {
        res.status(404).json({ code: "SIM-PLAT-0014", error: "Tenant not found" });
        return;
      }
      lifecycle.guardNotDecommissioned(tenant.status);

      await db.transaction(async (client) => {
        await client.query(
          "UPDATE ctrl.tenant SET status = 'archived' WHERE tenant_id = $1",
          [id],
        );
        await publisher.publishInTransaction(
          client,
          "sim.tenant.admin/TenantArchived/v1",
          id,
          { tenant_id: id },
        );
      });

      res.json({ tenant_id: id, status: "archived" });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
