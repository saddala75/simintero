import { randomUUID } from "node:crypto";
import type { CtrlDb } from "../db/index.js";

export type OperationKind = "provision" | "suspend" | "archive" | "migrate";
export type OperationStatus = "pending" | "running" | "completed" | "failed";

export interface Operation {
  operation_id: string;
  kind: OperationKind;
  tenant_id: string;
  status: OperationStatus;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export class OperationTracker {
  constructor(private readonly db: CtrlDb) {}

  async create(kind: OperationKind, tenantId: string): Promise<string> {
    const operationId = `op_${randomUUID()}`;
    await this.db.query(
      `INSERT INTO ctrl.operation (operation_id, kind, tenant_id, status)
       VALUES ($1, $2, $3, 'running')`,
      [operationId, kind, tenantId],
    );
    return operationId;
  }

  async update(
    operationId: string,
    status: OperationStatus,
    result?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `UPDATE ctrl.operation
          SET status     = $2,
              result     = $3,
              updated_at = now()
        WHERE operation_id = $1`,
      [operationId, status, result !== undefined ? JSON.stringify(result) : null],
    );
  }

  async get(operationId: string): Promise<Operation | undefined> {
    const rows = await this.db.query<Operation>(
      "SELECT * FROM ctrl.operation WHERE operation_id = $1",
      [operationId],
    );
    return rows[0];
  }
}
