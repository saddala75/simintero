import { ctx } from '@sim/tenant-context-ts';

const TASK_SERVICE_URL =
  process.env['TASK_SERVICE_URL'] ?? 'http://localhost:8091';

export interface RouteCaseInput {
  caseId: string;
  toQueue: string;
  reason?: string;
}

export interface RouteCasePayload {
  taskId: string | null;
  error: string | null;
}

/**
 * RouteCase mutation — POSTs to the task service to enqueue a case routing task.
 * Returns stub taskId if the service returns 501 (not yet implemented).
 */
export async function routeCase(
  input: RouteCaseInput
): Promise<RouteCasePayload> {
  const tenantCtx = ctx();

  try {
    const resp = await fetch(
      `${TASK_SERVICE_URL}/internal/tasks/route-case`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantCtx.tenant_id,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (resp.status === 501) {
      return { taskId: 'stub-task-id', error: null };
    }
    if (!resp.ok) {
      return { taskId: null, error: `Task service error: ${resp.status}` };
    }

    const result = (await resp.json()) as { taskId: string };
    return { taskId: result.taskId, error: null };
  } catch {
    return { taskId: null, error: 'Task service unreachable' };
  }
}
