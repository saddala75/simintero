import { describe, it, expect, vi } from "vitest";
import { startImpersonation, endImpersonation } from "../routes/support.js";
import type { CtrlDb, CtrlClient } from "../db/index.js";
import type { TenantEventPublisher } from "../events/TenantEventPublisher.js";
import type { TenantLifecycle } from "../lifecycle/TenantLifecycle.js";
import { SimError } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(
  queryRows: unknown[],
  transactionClientQuery?: ReturnType<typeof vi.fn>,
): CtrlDb {
  const clientQuery = transactionClientQuery ?? vi.fn().mockResolvedValue({ rows: [] });
  const mockClient: CtrlClient = { query: clientQuery as CtrlClient["query"] };
  return {
    query: vi.fn().mockResolvedValue(queryRows),
    transaction: async <T>(fn: (c: CtrlClient) => Promise<T>) => fn(mockClient),
  };
}

function makePublisher(): TenantEventPublisher {
  return {
    publishInTransaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as TenantEventPublisher;
}

function makeLifecycle(): TenantLifecycle {
  return {
    guardNotEnclave: vi.fn(),
    guardNotDecommissioned: vi.fn(),
  } as unknown as TenantLifecycle;
}

// ---------------------------------------------------------------------------
// startImpersonation
// ---------------------------------------------------------------------------

describe("startImpersonation", () => {
  it("inserts a session row alongside the audit event in the same transaction", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const db: CtrlDb = {
      query: vi.fn().mockResolvedValue([{ tenant_id: "t_001", tier: "pooled", status: "active" }]),
      transaction: async <T>(fn: (c: CtrlClient) => Promise<T>) =>
        fn({ query: clientQuery as CtrlClient["query"] }),
    };
    const publisher = makePublisher();
    const lifecycle = makeLifecycle();

    const result = await startImpersonation(db, lifecycle, publisher, "t_001");

    // Verify the INSERT into ctrl.impersonation_session was called
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("ctrl.impersonation_session"),
      expect.arrayContaining(["t_001"]),
    );

    // The INSERT params should be [sessionId, tenantId, expiresAt]
    const insertCall = (clientQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && (call[0] as string).includes("INSERT"),
    );
    expect(insertCall).toBeDefined();
    const [, insertParams] = insertCall as [string, string[]];
    expect(insertParams[1]).toBe("t_001"); // tenantId at position $2
    expect(insertParams[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp at $3

    // Response shape
    expect(result).toMatchObject({
      session_token: expect.any(String),
      tenant_id: "t_001",
      expires_at: expect.any(String),
    });
  });

  it("returns 404 when the tenant does not exist", async () => {
    const db = makeDb([]); // empty result → tenant not found
    const publisher = makePublisher();
    const lifecycle = makeLifecycle();

    await expect(startImpersonation(db, lifecycle, publisher, "t_missing")).rejects.toMatchObject({
      code: "SIM-PLAT-0014",
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// endImpersonation
// ---------------------------------------------------------------------------

describe("endImpersonation", () => {
  it("marks ended_at and publishes SupportImpersonationEnded in the same transaction", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    let capturedClient: CtrlClient | undefined;

    const activeSession = {
      session_id: "sess_abc",
      tenant_id: "t_002",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      ended_at: null,
    };

    const db: CtrlDb = {
      query: vi.fn().mockResolvedValue([activeSession]),
      transaction: async <T>(fn: (c: CtrlClient) => Promise<T>) => {
        const client: CtrlClient = { query: clientQuery as CtrlClient["query"] };
        capturedClient = client;
        return fn(client);
      },
    };

    const publisher = makePublisher();
    let publishedClient: CtrlClient | undefined;
    (publisher.publishInTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      (c: CtrlClient) => {
        publishedClient = c;
        return Promise.resolve();
      },
    );

    await endImpersonation(db, publisher, "sess_abc");

    // UPDATE was called with the session id
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ctrl.impersonation_session"),
      ["sess_abc"],
    );

    // Audit event was published with the correct type and tenant
    expect(publisher.publishInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      "sim.tenant.admin/SupportImpersonationEnded/v1",
      "t_002",
      expect.objectContaining({ tenant_id: "t_002", session_id: "sess_abc" }),
    );

    // Both operations used the same client — same transaction
    expect(publishedClient).toBe(capturedClient);
  });

  it("throws SIM-PLAT-0031 (404) when no active session exists", async () => {
    const db = makeDb([]); // empty result → session not found
    const publisher = makePublisher();

    const err = await endImpersonation(db, publisher, "sess_gone").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SimError);
    expect((err as SimError).code).toBe("SIM-PLAT-0031");
    expect((err as SimError).status).toBe(404);
  });
});
