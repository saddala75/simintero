import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { SimError } from "../errors.js";
import type { CtrlDb, CtrlClient } from "../db/index.js";
import type { TenantLifecycle } from "../lifecycle/TenantLifecycle.js";
import type { TenantEventPublisher } from "../events/TenantEventPublisher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TenantRow {
  tenant_id: string;
  tier: string;
  status: string;
}

export interface ImpersonationSessionRow {
  session_id: string;
  tenant_id: string;
  expires_at: string;
  ended_at: string | null;
}

// ---------------------------------------------------------------------------
// Business logic — extracted for testability
// ---------------------------------------------------------------------------

/**
 * Starts a support impersonation session for a tenant.
 * Persists the session row and audit event atomically in a single transaction.
 * Enclave tenants are rejected before any DB write.
 */
export async function startImpersonation(
  db: CtrlDb,
  lifecycle: TenantLifecycle,
  publisher: TenantEventPublisher,
  tenantId: string,
): Promise<{ session_token: string; tenant_id: string; expires_at: string }> {
  const rows = await db.query<TenantRow>(
    "SELECT tenant_id, tier, status FROM ctrl.tenant WHERE tenant_id = $1",
    [tenantId],
  );
  const tenant = rows[0];
  if (!tenant) {
    throw new SimError("SIM-PLAT-0014", 404, "Tenant not found");
  }

  // CRITICAL: enclave tenants must never be impersonated
  lifecycle.guardNotEnclave(tenant.tier);

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // +4h

  await db.transaction(async (client: CtrlClient) => {
    await publisher.publishInTransaction(
      client,
      "sim.tenant.admin/SupportImpersonationStarted/v1",
      tenantId,
      { tenant_id: tenantId, session_id: sessionId, expires_at: expiresAt.toISOString() },
    );
    await client.query(
      `INSERT INTO ctrl.impersonation_session (session_id, tenant_id, expires_at)
       VALUES ($1, $2, $3)`,
      [sessionId, tenantId, expiresAt.toISOString()],
    );
  });

  return { session_token: sessionId, tenant_id: tenantId, expires_at: expiresAt.toISOString() };
}

/**
 * Ends an active impersonation session.
 * Updates ended_at and appends the audit event in the same transaction.
 * Throws SIM-PLAT-0031 (404) if the session does not exist or is already ended/expired.
 */
export async function endImpersonation(
  db: CtrlDb,
  publisher: TenantEventPublisher,
  sessionId: string,
): Promise<void> {
  const rows = await db.query<ImpersonationSessionRow>(
    `SELECT * FROM ctrl.impersonation_session
     WHERE session_id = $1 AND ended_at IS NULL AND expires_at > NOW()`,
    [sessionId],
  );
  const session = rows[0];
  if (!session) {
    throw new SimError("SIM-PLAT-0031", 404, "Session not found");
  }

  await db.transaction(async (client: CtrlClient) => {
    await client.query(
      `UPDATE ctrl.impersonation_session SET ended_at = NOW() WHERE session_id = $1`,
      [sessionId],
    );
    await publisher.publishInTransaction(
      client,
      "sim.tenant.admin/SupportImpersonationEnded/v1",
      session.tenant_id,
      { tenant_id: session.tenant_id, session_id: sessionId },
    );
  });
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

export function createSupportRouter(
  db: CtrlDb,
  lifecycle: TenantLifecycle,
  publisher: TenantEventPublisher,
): Router {
  const router = Router();

  // POST /v1/support/impersonate — start an impersonation session
  router.post("/impersonate", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const tenantId = body["tenant_id"];

      if (typeof tenantId !== "string" || !tenantId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "tenant_id required" });
        return;
      }

      const result = await startImpersonation(db, lifecycle, publisher, tenantId);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  // DELETE /v1/support/impersonate/:session_id — end an impersonation session
  router.delete("/impersonate/:session_id", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params["session_id"];
      if (!sessionId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing session_id" });
        return;
      }

      await endImpersonation(db, publisher, sessionId);
      res.status(204).end();
    } catch (err) {
      handleError(err, res);
    }
  });

  // GET /v1/support/cases/:case_id/timeline — Phase 1 stub
  router.get("/cases/:case_id/timeline", async (req: Request, res: Response) => {
    try {
      const caseId = req.params["case_id"];
      if (!caseId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing case_id" });
        return;
      }
      // Phase 1: return empty timeline
      res.json({ case_id: caseId, events: [], pins: [] });
    } catch {
      res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
    }
  });

  // POST /v1/support/cases/:case_id/diagnostic-bundle — Phase 1 async stub
  router.post("/cases/:case_id/diagnostic-bundle", async (req: Request, res: Response) => {
    try {
      const caseId = req.params["case_id"];
      if (!caseId) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing case_id" });
        return;
      }
      const operationId = randomUUID();
      // Phase 1: return stub running operation
      res.status(202).json({ operation_id: operationId, status: "running" });
    } catch {
      res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
    }
  });

  return router;
}
