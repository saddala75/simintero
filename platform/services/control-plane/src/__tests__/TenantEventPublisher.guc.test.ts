import { describe, it, expect, vi } from "vitest";
import { TenantEventPublisher } from "../events/TenantEventPublisher.js";
import type { CtrlClient } from "../db/index.js";

describe("TenantEventPublisher GUC ordering", () => {
  it("sets sim.tenant_id GUC before the outbox INSERT on the same client", async () => {
    const calls: string[] = [];
    const mockQuery = vi.fn((sql: string) => {
      calls.push(sql);
      return Promise.resolve({ rows: [] });
    });
    const client: CtrlClient = { query: mockQuery as CtrlClient["query"] };

    const publisher = new TenantEventPublisher();
    await publisher.publishInTransaction(
      client,
      "sim.tenant.admin/TenantProvisioned/v1",
      "t_001",
      { foo: "bar" },
    );

    const guc = calls.findIndex((q) => q.includes("set_config('sim.tenant_id'"));
    const ins = calls.findIndex((q) => q.includes("INSERT INTO shared.outbox"));
    expect(guc).toBeGreaterThanOrEqual(0);
    expect(ins).toBeGreaterThan(guc);
  });

  it("passes the tenant id to set_config", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const client: CtrlClient = { query: mockQuery as CtrlClient["query"] };

    const publisher = new TenantEventPublisher();
    await publisher.publishInTransaction(
      client,
      "sim.tenant.admin/TenantProvisioned/v1",
      "t_042",
      {},
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("set_config('sim.tenant_id'"),
      ["t_042"],
    );
  });
});
