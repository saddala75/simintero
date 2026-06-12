import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContextMiddleware, ctx, withTenantContext } from "./index.js";
import type { Request, Response, NextFunction } from "express";

const validContext = {
  tenant_id: "t_test",
  cell_id: "cell-pooled-us1",
  tier: "pooled" as const,
  scopes: { lob: ["MA" as const], region: ["TX"], modules: ["ENS"] },
  roles: ["um_nurse_reviewer"],
  principal_type: "human" as const,
};

describe("TenantContext", () => {
  it("provides tenant context to nested calls via withTenantContext", async () => {
    await withTenantContext(validContext, async () => {
      expect(ctx().tenant_id).toBe("t_test");
      expect(ctx().cell_id).toBe("cell-pooled-us1");
      expect(ctx().tier).toBe("pooled");
      expect(ctx().principal_type).toBe("human");
    });
  });

  it("ctx() throws a descriptive error when no context is present", () => {
    // Run outside any withTenantContext — should throw
    expect(() => ctx()).toThrow("No tenant context");
  });

  it("withTenantContext is async-safe: nested contexts do not bleed into each other", async () => {
    const contextA = { ...validContext, tenant_id: "t_a" };
    const contextB = { ...validContext, tenant_id: "t_b" };

    let tenantSeenInA: string | undefined;
    let tenantSeenInB: string | undefined;

    await Promise.all([
      withTenantContext(contextA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        tenantSeenInA = ctx().tenant_id;
      }),
      withTenantContext(contextB, async () => {
        await new Promise((r) => setTimeout(r, 5));
        tenantSeenInB = ctx().tenant_id;
      }),
    ]);

    expect(tenantSeenInA).toBe("t_a");
    expect(tenantSeenInB).toBe("t_b");
  });

  it("middleware returns 401 when x-sim-ctx header is missing", () => {
    const middleware = createContextMiddleware({ verify: async () => validContext });
    const req = { headers: {} } as Request;
    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const res = { status: statusMock, json: jsonMock } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SIM-PLAT-0001" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("middleware calls next() and binds context when x-sim-ctx is valid", async () => {
    const verify = vi.fn().mockResolvedValue(validContext);
    const middleware = createContextMiddleware({ verify });
    const req = { headers: { "x-sim-ctx": "valid-token" } } as unknown as Request;
    const statusMock = vi.fn().mockReturnThis();
    const res = { status: statusMock, json: vi.fn() } as unknown as Response;

    let capturedTenantId: string | undefined;
    const next = vi.fn().mockImplementation(() => {
      capturedTenantId = ctx().tenant_id;
    }) as unknown as NextFunction;

    await middleware(req, res, next);

    expect(verify).toHaveBeenCalledWith("valid-token");
    expect(next).toHaveBeenCalled();
    expect(capturedTenantId).toBe("t_test");
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("middleware returns 401 when verify throws", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("invalid token"));
    const middleware = createContextMiddleware({ verify });
    const req = { headers: { "x-sim-ctx": "bad-token" } } as unknown as Request;
    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const res = { status: statusMock, json: jsonMock } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SIM-PLAT-0003" })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
