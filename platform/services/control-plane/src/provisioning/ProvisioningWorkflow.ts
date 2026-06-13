import type { Tier } from "@sim/tenant-context-ts";
import type { CellAssigner } from "./CellAssigner.js";
import type { Operation, OperationTracker } from "./OperationTracker.js";

export interface ProvisioningParams {
  tier: Tier;
  region: string;
  operationId: string;
  tenantId: string;
}

export interface ProvisioningDeps {
  cellAssigner: CellAssigner;
  tracker: OperationTracker;
}

/**
 * Phase 1 stub — orchestrates cell assignment and operation tracking.
 * In Phase 2 this will be replaced by a Temporal workflow activity.
 */
export async function runProvisioningWorkflow(
  params: ProvisioningParams,
  deps: ProvisioningDeps,
): Promise<Operation> {
  await deps.cellAssigner.assignCell(params.tier, params.region);
  await deps.tracker.update(params.operationId, "completed");

  const op = await deps.tracker.get(params.operationId);
  if (!op) {
    throw new Error(
      `Operation ${params.operationId} not found after update`,
    );
  }
  return op;
}
