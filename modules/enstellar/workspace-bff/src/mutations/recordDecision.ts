import { authorize } from '@sim/authz-client-ts';
import { ctx } from '@sim/tenant-context-ts';

const CASE_SERVICE_URL =
  process.env['CASE_SERVICE_URL'] ?? 'http://localhost:8090';

export interface PerLineInput {
  lineId: string;
  outcome: string;
}

export interface RecordDecisionInput {
  caseId: string;
  outcome: string;
  rationale?: string;
  decisionNote?: string;
  perLine?: PerLineInput[];
}

export interface RecordDecisionPayload {
  determinationId: string | null;
  error: string | null;
  errorCode: string | null;
}

/**
 * RecordDecision mutation:
 * 1. Authorizes via OPA (adverse action guard) — returns 403 payload if denied.
 * 2. POSTs to the case-service RecordDecision endpoint (stubs if unavailable).
 */
export async function recordDecision(
  input: RecordDecisionInput
): Promise<RecordDecisionPayload> {
  // 1. Authorize — throws Error{code: SIM-AUTHZ-0001, status: 403} if denied
  try {
    await authorize({
      action: 'adverse_action',
      resource: { case_id: input.caseId, outcome: input.outcome },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SIM-AUTHZ-0001') {
      return {
        determinationId: null,
        error: 'Forbidden: medical director role required',
        errorCode: '403',
      };
    }
    throw err;
  }

  // 2. POST to case-service (stub if unavailable)
  try {
    const resp = await fetch(
      `${CASE_SERVICE_URL}/internal/case/commands/record-decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': ctx().tenant_id,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (resp.status === 501) {
      return { determinationId: 'stub-det-id', error: null, errorCode: null };
    }
    if (!resp.ok) {
      return {
        determinationId: null,
        error: 'Case service error',
        errorCode: String(resp.status),
      };
    }

    const result = (await resp.json()) as { determinationId: string };
    return { determinationId: result.determinationId, error: null, errorCode: null };
  } catch {
    return {
      determinationId: null,
      error: 'Case service unreachable',
      errorCode: '503',
    };
  }
}
