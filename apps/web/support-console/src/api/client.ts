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

// ── DLQ Admin ─────────────────────────────────────────────────────────────

export interface OutboxDlqEvent {
  event_id: string
  topic: string
  tenant_id: string
  dlq_at: string | null
  dlq_reason: string | null
  retry_count: number
}

export interface ConsumerDlqEvent {
  event_id: string
  consumer_group: string
  topic: string
  error: string | null
  failed_at: string | null
  replayed_at: string | null
}

const MOCK_OUTBOX_DLQ: OutboxDlqEvent[] = [
  { event_id: 'evt-mock-001', topic: 'prior_auth.submitted', tenant_id: 'demo-tenant', dlq_at: '2026-06-30T10:00:00Z', dlq_reason: 'Kafka timeout after 3 retries', retry_count: 3 },
  { event_id: 'evt-mock-002', topic: 'decision.recorded', tenant_id: 'tenant-beta', dlq_at: '2026-06-30T09:15:00Z', dlq_reason: 'Serialization error', retry_count: 1 },
]

const MOCK_CONSUMER_DLQ: ConsumerDlqEvent[] = [
  { event_id: 'evt-mock-003', consumer_group: 'intake-consumer', topic: 'prior_auth.submitted', error: 'DB connection refused', failed_at: '2026-06-30T08:30:00Z', replayed_at: null },
]

export async function getOutboxDlq(token: string): Promise<OutboxDlqEvent[]> {
  try {
    const res = await fetch('/bff/admin/dlq/outbox', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return (await res.json()).events
  } catch {}
  return MOCK_OUTBOX_DLQ
}

export async function getConsumerDlq(token: string): Promise<ConsumerDlqEvent[]> {
  try {
    const res = await fetch('/bff/admin/dlq/consumers', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return (await res.json()).events
  } catch {}
  return MOCK_CONSUMER_DLQ
}

export async function reprocessOutboxEvent(
  eventId: string,
  token: string,
): Promise<{ requeued: boolean }> {
  const res = await fetch(`/bff/admin/dlq/outbox/${eventId}/reprocess`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Reprocess failed: ${res.status}`)
  return res.json()
}
