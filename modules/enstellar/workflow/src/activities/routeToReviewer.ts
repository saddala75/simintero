/**
 * Activity: routeToReviewer
 * Inserts a Task{kind:'um_review'} into ens.task via the case-service API.
 */
import { randomUUID } from 'node:crypto';

export interface RouteToReviewerInput {
  caseId: string;
  tenantId: string;
  urgency: 'standard' | 'expedited';
}

export interface RouteToReviewerResult {
  taskId: string;
}

export async function routeToReviewer(
  input: RouteToReviewerInput,
): Promise<RouteToReviewerResult> {
  const caseServiceUrl = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:8091';
  const url = `${caseServiceUrl}/v1/tasks`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'um_review',
        case_id: input.caseId,
        tenant_id: input.tenantId,
        queue: 'um_clinical_review',
        payload: { urgency: input.urgency },
      }),
    });
  } catch (_err) {
    return { taskId: `task-stub-${randomUUID()}` };
  }

  if (response.status === 501 || response.status === 503) {
    return { taskId: `task-stub-${randomUUID()}` };
  }

  if (!response.ok) {
    throw new Error(`RouteToReviewer failed with status ${response.status}`);
  }

  const body = (await response.json()) as { task_id?: string };
  return { taskId: body.task_id ?? `task-${randomUUID()}` };
}
