export interface ImpersonationSession {
  session_token: string;
  expires_at: string;
  tenant_id: string;
}

export interface CaseEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

const BASE_URL = import.meta.env['VITE_CONTROL_PLANE_URL'] ?? 'http://localhost:3030';

export const supportConsoleClient = {
  async startImpersonation(tenantId: string, reason: string): Promise<ImpersonationSession> {
    const res = await fetch(`${BASE_URL}/v1/support/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, reason }),
    });
    if (!res.ok) {
      const err = await res.json() as { code: string; error: string };
      throw Object.assign(new Error(err.error), { code: err.code, status: res.status });
    }
    return res.json() as Promise<ImpersonationSession>;
  },
  async endImpersonation(sessionId: string): Promise<void> {
    await fetch(`${BASE_URL}/v1/support/impersonate/${sessionId}`, { method: 'DELETE' });
  },
  async getCaseTimeline(caseId: string, sessionToken: string): Promise<CaseEvent[]> {
    const res = await fetch(`${BASE_URL}/v1/support/cases/${caseId}/timeline`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
    });
    const data = await res.json() as { events: CaseEvent[] };
    return data.events ?? [];
  },
  async requestDiagnosticBundle(caseId: string): Promise<{ operation_id: string }> {
    const res = await fetch(`${BASE_URL}/v1/support/cases/${caseId}/diagnostic-bundle`, {
      method: 'POST',
    });
    return res.json() as Promise<{ operation_id: string }>;
  },
};
