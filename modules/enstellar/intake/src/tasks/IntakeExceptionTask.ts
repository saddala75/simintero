import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface IntakeExceptionPayload {
  memberRef: string;
  reason: string;
  memberResolutionScore?: number;
  rawPayloadRef?: string;
}

export async function createIntakeExceptionTask(
  db: TenantDb,
  caseId: string | null,
  payload: IntakeExceptionPayload
): Promise<string> {
  const tenantCtx = ctx();
  const taskId = randomUUID();

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO ens.task (task_id, case_id, tenant_id, kind, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        taskId,
        caseId,
        tenantCtx.tenant_id,
        'intake_exception',
        JSON.stringify(payload),
      ]
    );
  });

  return taskId;
}
