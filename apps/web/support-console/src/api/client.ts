export interface ImpersonationSession {
  sessionId: string
  targetUser: string
  tenantId: string
  role: string
  status: 'active' | 'terminated'
  startedAt: string
}

export interface TraceSpan {
  traceId: string
  service: string
  operation: string
  durationMs: number
  status: 'ok' | 'error'
  timestamp: string
}

const MOCK_TRACES: TraceSpan[] = [
  { traceId: 'tr-9921', service: 'enstellar-bff', operation: 'GET /bff/cases/PA-88492', durationMs: 45, status: 'ok', timestamp: '2026-06-28 19:40:12' },
  { traceId: 'tr-9922', service: 'enstellar-workflow', operation: 'TransitionEngine.apply', durationMs: 120, status: 'ok', timestamp: '2026-06-28 19:40:12' },
  { traceId: 'tr-9923', service: 'revital-ai', operation: 'ExtractEntities', durationMs: 450, status: 'ok', timestamp: '2026-06-28 19:40:11' },
]

export async function startImpersonation(targetUser: string, tenantId: string): Promise<ImpersonationSession> {
  try {
    const res = await fetch('/v1/support/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_user: targetUser, tenant_id: tenantId }),
    })
    if (res.ok) return await res.json()
  } catch {}
  return {
    sessionId: `sess-${Math.floor(Math.random() * 9000 + 1000)}`,
    targetUser,
    tenantId,
    role: 'reviewer',
    status: 'active',
    startedAt: new Date().toISOString(),
  }
}

export async function getTraces(): Promise<TraceSpan[]> {
  try {
    const res = await fetch('/support/traces')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_TRACES
}

export async function triggerTestEvent(caseId: string, eventType: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch('/support/test-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId, event_type: eventType }),
    })
    if (res.ok) return await res.json()
  } catch {}
  return { success: true }
}
