import { describe, it, expect, vi } from "vitest";
import { upsertEntitlement, type EntitlementRow } from "../routes/entitlements.js";
import type { CtrlDb, CtrlClient } from "../db/index.js";
import type { TenantEventPublisher } from "../events/TenantEventPublisher.js";

describe("upsertEntitlement", () => {
  it("writes ctrl.entitlement row inside a transaction", async () => {
    const expectedRow: EntitlementRow = {
      tenant_id: "t_001",
      key: "max_cases",
      value: "100",
      expires_at: null,
    };

    const mockQuery = vi.fn().mockResolvedValue({ rows: [expectedRow] });
    const mockClient: CtrlClient = { query: mockQuery as CtrlClient["query"] };

    const db: CtrlDb = {
      transaction: <T>(fn: (c: CtrlClient) => Promise<T>) => fn(mockClient),
      query: vi.fn(),
    };

    const publisher = {
      publishInTransaction: vi.fn().mockResolvedValue(undefined),
    } as unknown as TenantEventPublisher;

    const result = await upsertEntitlement(db, publisher, "t_001", "max_cases", "100", null);

    // Verify the upsert SQL was executed (value is JSON.stringified for JSONB column)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ctrl.entitlement"),
      ["t_001", "max_cases", JSON.stringify("100"), null],
    );
    expect(result).toEqual(expectedRow);
  });

  it("appends EntitlementChanged event to outbox in the SAME transaction", async () => {
    const expectedRow: EntitlementRow = {
      tenant_id: "t_002",
      key: "feature_x",
      value: "enabled",
      expires_at: null,
    };

    const mockQuery = vi.fn().mockResolvedValue({ rows: [expectedRow] });

    let capturedClient: CtrlClient | undefined;
    let publishedClient: CtrlClient | undefined;

    const db: CtrlDb = {
      transaction: async <T>(fn: (c: CtrlClient) => Promise<T>) => {
        const client: CtrlClient = { query: mockQuery as CtrlClient["query"] };
        capturedClient = client;
        return fn(client);
      },
      query: vi.fn(),
    };

    const publisher = {
      publishInTransaction: vi.fn().mockImplementation((c: CtrlClient) => {
        publishedClient = c;
        return Promise.resolve();
      }),
    } as unknown as TenantEventPublisher;

    await upsertEntitlement(db, publisher, "t_002", "feature_x", "enabled", null);

    // Both operations used the identical client reference — same transaction
    expect(publishedClient).toBe(capturedClient);

    // Publisher called with correct event type and tenant
    expect(publisher.publishInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      "sim.tenant.admin/EntitlementChanged/v1",
      "t_002",
      expect.objectContaining({ key: "feature_x", value: "enabled" }),
    );
  });

  it("returns 200-equivalent payload with updated entitlement", async () => {
    const expectedRow: EntitlementRow = {
      tenant_id: "t_003",
      key: "sla_tier",
      value: "platinum",
      expires_at: "2027-01-01T00:00:00Z",
    };

    const mockQuery = vi.fn().mockResolvedValue({ rows: [expectedRow] });
    const mockClient: CtrlClient = { query: mockQuery as CtrlClient["query"] };

    const db: CtrlDb = {
      transaction: <T>(fn: (c: CtrlClient) => Promise<T>) => fn(mockClient),
      query: vi.fn(),
    };

    const publisher = {
      publishInTransaction: vi.fn().mockResolvedValue(undefined),
    } as unknown as TenantEventPublisher;

    const result = await upsertEntitlement(
      db,
      publisher,
      "t_003",
      "sla_tier",
      "platinum",
      "2027-01-01T00:00:00Z",
    );

    expect(result.tenant_id).toBe("t_003");
    expect(result.key).toBe("sla_tier");
    expect(result.value).toBe("platinum");
    expect(result.expires_at).toBe("2027-01-01T00:00:00Z");
  });
});
