import { describe, it, expect, vi } from "vitest";
import {
  runProvisioningWorkflow,
  type ProvisioningDeps,
} from "../provisioning/ProvisioningWorkflow.js";
import type { Operation } from "../provisioning/OperationTracker.js";

const baseOperation: Operation = {
  operation_id: "op_test",
  kind: "provision",
  tenant_id: "t_test",
  status: "completed",
  result: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:01Z",
};

function makeDeps(overrides?: Partial<ProvisioningDeps>): ProvisioningDeps {
  return {
    cellAssigner: {
      assignCell: vi.fn().mockResolvedValue("cell-pooled-us1"),
    } as unknown as ProvisioningDeps["cellAssigner"],
    tracker: {
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ ...baseOperation }),
    } as unknown as ProvisioningDeps["tracker"],
    ...overrides,
  };
}

describe("ProvisioningWorkflow (Phase 1 stub)", () => {
  it("calls CellAssigner.assignCell with the correct tier and region", async () => {
    const deps = makeDeps();

    await runProvisioningWorkflow(
      { tier: "pooled", region: "us-east-1", operationId: "op_test", tenantId: "t_test" },
      deps,
    );

    expect(deps.cellAssigner.assignCell).toHaveBeenCalledOnce();
    expect(deps.cellAssigner.assignCell).toHaveBeenCalledWith("pooled", "us-east-1");
  });

  it("calls CellAssigner with the requested tier for dedicated tenants", async () => {
    const deps = makeDeps();

    await runProvisioningWorkflow(
      { tier: "dedicated", region: "us-west-2", operationId: "op_test2", tenantId: "t_test2" },
      deps,
    );

    expect(deps.cellAssigner.assignCell).toHaveBeenCalledWith("dedicated", "us-west-2");
  });

  it("updates the operation to status=completed", async () => {
    const deps = makeDeps();

    await runProvisioningWorkflow(
      { tier: "pooled", region: "us-east-1", operationId: "op_abc", tenantId: "t_abc" },
      deps,
    );

    expect(deps.tracker.update).toHaveBeenCalledWith("op_abc", "completed");
  });

  it("returns the final operation state from the tracker", async () => {
    const finalOp: Operation = {
      ...baseOperation,
      operation_id: "op_final",
      tenant_id: "t_final",
      result: { cell_id: "cell-pooled-us1" },
    };

    const deps = makeDeps({
      tracker: {
        update: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(finalOp),
      } as unknown as ProvisioningDeps["tracker"],
    });

    const result = await runProvisioningWorkflow(
      { tier: "pooled", region: "us-east-1", operationId: "op_final", tenantId: "t_final" },
      deps,
    );

    expect(result).toEqual(finalOp);
    expect(result.status).toBe("completed");
  });

  it("throws if the operation cannot be found after update", async () => {
    const deps = makeDeps({
      tracker: {
        update: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProvisioningDeps["tracker"],
    });

    await expect(
      runProvisioningWorkflow(
        { tier: "pooled", region: "us-east-1", operationId: "op_gone", tenantId: "t_x" },
        deps,
      ),
    ).rejects.toThrow("not found");
  });
});
