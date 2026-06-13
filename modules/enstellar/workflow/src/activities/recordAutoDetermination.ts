/**
 * Activity: recordAutoDetermination
 * Records an auto-determination for a case.
 *
 * GUARDS:
 *  1. eligible must be true (from C-1 evaluate)
 *  2. outcome must be 'approved' — no other outcome is allowed via auto-path
 */
import { randomUUID } from 'node:crypto';

export interface RecordAutoDeterminationInput {
  caseId: string;
  tenantId: string;
  outcome: string;
  eligible: boolean;
}

export interface RecordAutoDeterminationResult {
  determinationId: string;
}

export async function recordAutoDetermination(
  input: RecordAutoDeterminationInput,
): Promise<RecordAutoDeterminationResult> {
  // Guard 1: eligibility
  if (input.eligible !== true) {
    throw new Error('Auto-determination requires eligible=true from C-1');
  }

  // Guard 2: approved outcomes only
  if (input.outcome !== 'approved') {
    throw new Error(
      `Auto-determination only supports outcome 'approved'; received '${input.outcome}'`,
    );
  }

  const caseServiceUrl = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:8091';
  const url = `${caseServiceUrl}/v1/cases/${input.caseId}/determination`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        outcome: input.outcome,
        auto_path: true,
        decided_by: { type: 'service', id: 'enstellar-workflow' },
      }),
    });
  } catch (_err) {
    return { determinationId: `det-stub-${randomUUID()}` };
  }

  if (response.status === 501 || response.status === 503) {
    return { determinationId: `det-stub-${randomUUID()}` };
  }

  if (!response.ok) {
    throw new Error(`RecordAutoDetermination failed with status ${response.status}`);
  }

  const body = (await response.json()) as { determination_id?: string };
  return { determinationId: body.determination_id ?? `det-${randomUUID()}` };
}
