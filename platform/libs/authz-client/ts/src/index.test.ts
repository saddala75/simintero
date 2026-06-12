import { describe, it, expect, vi, beforeEach } from "vitest";
import { withTenantContext } from "@sim/tenant-context-ts";
import { authorize } from "./index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const testCtx = {
  tenant_id: "t_test",
  cell_id: "cell-pooled-us1",
  tier: "pooled" as const,
  scopes: { lob: ["MA" as const], region: ["TX"], modules: ["ENS"] },
  roles: ["medical_director"],
  principal_type: "human" as const,
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("authorize", () => {
  it("resolves without throwing when OPA allows", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: true }),
    });

    await withTenantContext(testCtx, async () => {
      await expect(authorize({ action: "decision.record", resource: { outcome: "deny", rationale: "x", trace_ref: "t" } }))
        .resolves.toBeUndefined();
    });
  });

  it("throws SIM-AUTHZ-0001 when OPA returns false", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: false }),
    });

    await withTenantContext(testCtx, async () => {
      await expect(authorize({ action: "decision.record", resource: { outcome: "deny", rationale: "", trace_ref: "" } }))
        .rejects.toMatchObject({ code: "SIM-AUTHZ-0001", status: 403 });
    });
  });

  it("throws when OPA is unreachable (non-ok response)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await withTenantContext(testCtx, async () => {
      await expect(authorize({ action: "decision.record", resource: {} }))
        .rejects.toThrow("OPA unreachable: 503");
    });
  });

  it("includes tenant context in OPA payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: true }),
    });

    await withTenantContext(testCtx, async () => {
      await authorize({ action: "case.read", resource: {} });
    });

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.input.principal.sim.tenant_id).toBe("t_test");
    expect(body.input.principal.sim.roles).toContain("medical_director");
    expect(body.input.principal.sim.principal_type).toBe("human");
  });
});
