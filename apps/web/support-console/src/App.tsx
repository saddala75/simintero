import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getTraces, triggerTestEvent, startImpersonation, type TraceSpan, type ImpersonationSession, getOutboxDlq, getConsumerDlq, reprocessOutboxEvent, type OutboxDlqEvent, type ConsumerDlqEvent } from './api/client'
import { Card, Badge, Button, DataTable, type Column } from '@sim/design-system'

export default function App() {
  const [activeSession, setActiveSession] = useState<ImpersonationSession | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testCaseId, setTestCaseId] = useState('PA-2026-88492')
  const [targetEmail, setTargetEmail] = useState('dr.chen@aetna.com')
  const [targetTenant, setTargetTenant] = useState('ten-001')
  const [dlqTab, setDlqTab] = useState<'outbox' | 'consumers'>('outbox')
  const [adminToken, setAdminToken] = useState('')
  const [reprocessMsg, setReprocessMsg] = useState<string | null>(null)

  const { data: traces = [], isLoading } = useQuery({
    queryKey: ['traces'],
    queryFn: getTraces,
  })

  const impersonateMut = useMutation({
    mutationFn: () => startImpersonation(targetEmail, targetTenant),
    onSuccess: (session) => {
      setActiveSession(session)
      setTestMsg(`Impersonation session initialized for target ${session.targetUser} on tenant ${session.tenantId}! Audit logged.`)
    },
  })

  const eventMut = useMutation({
    mutationFn: (eventType: string) => triggerTestEvent(testCaseId, eventType),
    onSuccess: (_, eventType) => {
      setTestMsg(`Test event "${eventType}" successfully emitted to Kafka for case ${testCaseId}! Pipeline verified.`)
    },
  })

  const outboxQuery = useQuery({
    queryKey: ['dlq', 'outbox', adminToken],
    queryFn: () => getOutboxDlq(adminToken),
    enabled: adminToken.length > 0,
  })

  const consumersQuery = useQuery({
    queryKey: ['dlq', 'consumers', adminToken],
    queryFn: () => getConsumerDlq(adminToken),
    enabled: adminToken.length > 0,
  })

  const reprocessMut = useMutation({
    mutationFn: ({ eventId }: { eventId: string }) =>
      reprocessOutboxEvent(eventId, adminToken),
    onSuccess: (_, { eventId }) => {
      setReprocessMsg(`Event ${eventId} requeued — relay will retry shortly.`)
      outboxQuery.refetch()
    },
  })

  const columns: Column<TraceSpan>[] = [
    { key: 'traceId', header: 'Trace ID', render: (r) => <span className="font-mono text-xs font-bold">{r.traceId}</span> },
    { key: 'service', header: 'Microservice', render: (r) => <Badge variant="rule" label={r.service.toUpperCase()} /> },
    { key: 'operation', header: 'Span Operation', render: (r) => <span className="font-mono text-xs font-bold text-slate-900">{r.operation}</span> },
    { key: 'durationMs', header: 'Latency', render: (r) => <span className="font-mono text-xs font-bold text-blue-700">{r.durationMs}ms</span> },
    { key: 'timestamp', header: 'Timestamp', render: (r) => <span className="font-mono text-xs text-slate-500">{r.timestamp}</span> },
  ]

  const outboxColumns: Column<OutboxDlqEvent>[] = [
    { key: 'event_id', header: 'Event ID', render: (r) => <span className="font-mono text-xs">{r.event_id}</span> },
    { key: 'topic', header: 'Topic', render: (r) => <Badge variant="rule" label={r.topic} /> },
    { key: 'tenant_id', header: 'Tenant', render: (r) => <span className="font-mono text-xs">{r.tenant_id}</span> },
    { key: 'retry_count', header: 'Retries', render: (r) => <span className="font-mono text-xs font-bold text-red-600">{r.retry_count}</span> },
    { key: 'dlq_reason', header: 'Reason', render: (r) => <span className="text-xs text-slate-500 truncate max-w-[200px]">{r.dlq_reason}</span> },
    { key: 'dlq_at', header: 'DLQ At', render: (r) => <span className="font-mono text-xs text-slate-500">{r.dlq_at}</span> },
    {
      key: 'action',
      header: 'Action',
      render: (r) => (
        <Button
          variant="primary"
          size="sm"
          loading={reprocessMut.isPending}
          onClick={() => reprocessMut.mutate({ eventId: r.event_id })}
        >
          Reprocess
        </Button>
      ),
    },
  ]

  const consumerColumns: Column<ConsumerDlqEvent>[] = [
    { key: 'event_id', header: 'Event ID', render: (r) => <span className="font-mono text-xs">{r.event_id}</span> },
    { key: 'consumer_group', header: 'Consumer', render: (r) => <Badge variant="rule" label={r.consumer_group} /> },
    { key: 'topic', header: 'Topic', render: (r) => <span className="font-mono text-xs">{r.topic}</span> },
    { key: 'error', header: 'Error', render: (r) => <span className="text-xs text-red-600 truncate max-w-[200px]">{r.error}</span> },
    { key: 'failed_at', header: 'Failed At', render: (r) => <span className="font-mono text-xs text-slate-500">{r.failed_at}</span> },
    { key: 'replayed_at', header: 'Replayed', render: (r) => <span className="font-mono text-xs text-slate-500">{r.replayed_at ?? '—'}</span> },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {activeSession && (
          <div className="p-4 bg-amber-500 text-slate-950 font-bold text-xs rounded-md flex justify-between items-center shadow-md">
            <span>⚠️ IMPERSONATION SESSION ACTIVE: Currently debugging as "{activeSession.targetUser}" (Tenant: {activeSession.tenantId}) — Session: {activeSession.sessionId}</span>
            <button onClick={() => setActiveSession(null)} className="bg-slate-950 text-white px-3 py-1 rounded text-[11px] hover:bg-slate-800">End Session</button>
          </div>
        )}

        {testMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex justify-between items-center">
            <span>✓ {testMsg}</span>
            <button onClick={() => setTestMsg(null)} className="font-bold text-xs">✕ Dismiss</button>
          </div>
        )}

        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Platform Support & Debugging Console</h1>
          <p className="text-sm text-slate-500 mt-1">OpenTelemetry Tracing, Impersonation Debugging & Event Pipeline Simulation</p>
        </div>

        <Card className="p-6 space-y-4">
          <h3 className="font-bold text-base text-slate-900">Support Impersonation Debugger (/v1/support/impersonate)</h3>
          <div className="flex gap-3 items-center text-xs">
            <input
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="Target User Email"
              className="px-3 py-2 border border-slate-300 rounded font-mono w-64"
            />
            <input
              type="text"
              value={targetTenant}
              onChange={(e) => setTargetTenant(e.target.value)}
              placeholder="Tenant ID"
              className="px-3 py-2 border border-slate-300 rounded font-mono w-32"
            />
            <Button
              variant="primary"
              size="sm"
              loading={impersonateMut.isPending}
              onClick={() => impersonateMut.mutate()}
            >
              Start Impersonation Session
            </Button>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-bold text-base text-slate-900">Kafka Event Pipeline & Timeline Simulator</h3>
          <div className="flex gap-3 items-center text-xs">
            <input
              type="text"
              value={testCaseId}
              onChange={(e) => setTestCaseId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded font-mono w-48"
            />
            <Button variant="primary" size="sm" loading={eventMut.isPending} onClick={() => eventMut.mutate('prior_auth.submitted')}>Emit PA Submitted Event</Button>
            <Button variant="ai" size="sm" loading={eventMut.isPending} onClick={() => eventMut.mutate('ai.analysis_completed')}>Emit AI Analysis Completed</Button>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-bold text-base text-slate-900 mb-4">OpenTelemetry Distributed Traces</h3>
          {isLoading ? <div className="p-8 text-center text-slate-500">Loading OpenTelemetry traces…</div> : <DataTable columns={columns} data={traces} keyExtractor={(r) => r.traceId} />}
        </Card>

        {reprocessMsg && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800 flex justify-between items-center">
            <span>✓ {reprocessMsg}</span>
            <button onClick={() => setReprocessMsg(null)} className="font-bold text-xs">✕ Dismiss</button>
          </div>
        )}

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-slate-900">Dead Letter Queue Admin</h3>
            {adminToken && <Badge variant="status" status="approved" label="Connected" />}
          </div>

          <div className="flex gap-3 items-center text-xs">
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="saas_admin Bearer token"
              className="px-3 py-2 border border-slate-300 rounded font-mono w-96"
            />
          </div>

          <div className="flex gap-2 border-b border-slate-200">
            {(['outbox', 'consumers'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDlqTab(tab)}
                className={`px-4 py-2 text-xs font-semibold capitalize border-b-2 transition-colors ${
                  dlqTab === tab
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'outbox' ? 'Outbox DLQ' : 'Consumer DLQ'}
              </button>
            ))}
          </div>

          {!adminToken ? (
            <div className="p-8 text-center text-slate-400 text-sm">Enter a saas_admin token above to load DLQ events.</div>
          ) : dlqTab === 'outbox' ? (
            outboxQuery.isLoading ? (
              <div className="p-8 text-center text-slate-500">Loading outbox DLQ…</div>
            ) : (
              <DataTable
                columns={outboxColumns}
                data={outboxQuery.data ?? []}
                keyExtractor={(r) => r.event_id}
              />
            )
          ) : (
            consumersQuery.isLoading ? (
              <div className="p-8 text-center text-slate-500">Loading consumer DLQ…</div>
            ) : (
              <DataTable
                columns={consumerColumns}
                data={consumersQuery.data ?? []}
                keyExtractor={(r) => r.event_id}
              />
            )
          )}
        </Card>
      </div>
    </div>
  )
}
