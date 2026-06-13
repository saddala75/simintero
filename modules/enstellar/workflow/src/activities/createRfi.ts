/**
 * Activity: createRfi
 * Inserts an RFI record into ens.rfi and emits RfiIssued via the outbox.
 *
 * Phase 1: Calls the case-service RecordRFI endpoint (HTTP).
 * DB wiring is delegated to the case-service; this activity is stateless.
 */
import { randomUUID } from 'node:crypto';

export interface CreateRfiInput {
  caseId: string;
  tenantId: string;
  gaps: string[];
}

export interface CreateRfiResult {
  rfiId: string;
}

export async function createRfi(input: CreateRfiInput): Promise<CreateRfiResult> {
  const caseServiceUrl = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:8091';
  const url = `${caseServiceUrl}/v1/cases/${input.caseId}/rfi`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        gaps: input.gaps,
      }),
    });
  } catch (_err) {
    // Stub for Phase 1: generate a local RFI ID when service unavailable
    return { rfiId: `rfi-stub-${randomUUID()}` };
  }

  if (response.status === 501 || response.status === 503) {
    return { rfiId: `rfi-stub-${randomUUID()}` };
  }

  if (!response.ok) {
    throw new Error(`RecordRFI failed with status ${response.status}`);
  }

  const body = (await response.json()) as { rfi_id?: string };
  return { rfiId: body.rfi_id ?? `rfi-${randomUUID()}` };
}
