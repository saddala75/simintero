import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getModelBindings, promoteCanary, runEvalSuite, getDriftTrends, type ModelBinding, type EvalTestCase, type DriftTrend } from './api/client'
import { Card, Badge, Button, DataTable, type Column } from '@sim/design-system'

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'registry' | 'eval' | 'drift'>('registry')
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const { data: models = [], isLoading: loadingModels } = useQuery({ queryKey: ['model-bindings'], queryFn: getModelBindings })
  const { data: evals = [], isLoading: loadingEvals } = useQuery({ queryKey: ['eval-suite'], queryFn: () => runEvalSuite('mb-003') })
  const { data: drift = [], isLoading: loadingDrift } = useQuery({ queryKey: ['drift-trends'], queryFn: getDriftTrends })

  const canaryMut = useMutation({
    mutationFn: (id: string) => promoteCanary(id),
    onSuccess: (_, id) => {
      setActionMsg(`Candidate model ${id} successfully promoted to 10% Canary traffic! Eval telemetry monitoring active.`)
      queryClient.invalidateQueries({ queryKey: ['model-bindings'] })
    },
  })

  const modelColumns: Column<ModelBinding>[] = [
    { key: 'id', header: 'Binding ID', render: (r) => <span className="font-mono text-xs font-bold">{r.id}</span> },
    { key: 'name', header: 'Model Architecture & Version', render: (r) => <div><div className="font-bold text-slate-900">{r.name}</div><div className="text-xs font-mono text-slate-500">{r.version}</div></div> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant="status" status={r.status === 'active' ? 'approved' : r.status === 'canary' ? 'in_review' : 'pending'} label={r.status.toUpperCase()} /> },
    { key: 'evalScore', header: 'Benchmark Eval Score', render: (r) => <span className="font-mono text-xs font-bold text-emerald-700">{r.evalScore}%</span> },
    { key: 'citationResolveRate', header: 'Citation Grounding', render: (r) => <span className="font-mono text-xs font-bold text-blue-700">{r.citationResolveRate}%</span> },
    { key: 'trafficPct', header: 'Traffic Split', render: (r) => <span className="font-mono text-xs font-bold px-2 py-0.5 bg-slate-100 rounded">{r.trafficPct}%</span> },
    {
      key: 'action',
      header: 'Actions',
      render: (r) => (
        <Button
          variant={r.status === 'candidate' ? 'ai' : 'ghost'}
          size="sm"
          disabled={r.status !== 'candidate' || canaryMut.isPending}
          onClick={() => canaryMut.mutate(r.id)}
        >
          {r.status === 'active' ? 'Production Leader' : r.status === 'canary' ? 'Canary Active (10%)' : 'Promote to Canary'}
        </Button>
      ),
    },
  ]

  const evalColumns: Column<EvalTestCase>[] = [
    { key: 'id', header: 'Test ID', render: (r) => <span className="font-mono text-xs font-bold">{r.id}</span> },
    { key: 'caseName', header: 'Clinical Scenario Benchmark', render: (r) => <span className="font-bold text-slate-900">{r.caseName}</span> },
    { key: 'citationResolved', header: 'Citation Resolved', render: (r) => <span className={`font-mono text-xs font-bold ${r.citationResolved ? 'text-emerald-700' : 'text-red-700'}`}>{r.citationResolved ? '✓ YES' : '✕ NO'}</span> },
    { key: 'confidenceScore', header: 'Confidence Calibration', render: (r) => <span className="font-mono text-xs font-bold">{(r.confidenceScore * 100).toFixed(0)}%</span> },
    { key: 'abstentionStatus', header: 'Abstention Gate', render: (r) => <Badge variant="status" status={r.abstentionStatus === 'passed' ? 'approved' : 'pending'} label={r.abstentionStatus.toUpperCase()} /> },
  ]

  const driftColumns: Column<DriftTrend>[] = [
    { key: 'week', header: 'Monitoring Window', render: (r) => <span className="font-bold text-slate-900">{r.week}</span> },
    { key: 'avgConfidence', header: 'Avg Confidence Score', render: (r) => <span className="font-mono text-xs font-bold text-blue-700">{(r.avgConfidence * 100).toFixed(0)}%</span> },
    { key: 'abstentionRate', header: 'Abstention Frequency', render: (r) => <span className="font-mono text-xs font-bold text-slate-800">{r.abstentionRate}%</span> },
    { key: 'topExtractedEntity', header: 'Dominant Entity Grounding', render: (r) => <Badge variant="rule" label={r.topExtractedEntity} /> },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {actionMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex justify-between items-center">
            <span>✓ {actionMsg}</span>
            <button onClick={() => setActionMsg(null)} className="font-bold text-xs">✕ Dismiss</button>
          </div>
        )}

        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Revital AI Ops & Model Governance Console</h1>
          <p className="text-sm text-slate-500 mt-1">VKAS Candidate Bindings, Benchmark Eval Gates & Model Drift Telemetry</p>
        </div>

        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit text-xs font-semibold">
          {(['registry', 'eval', 'drift'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md capitalize transition-colors ${activeTab === tab ? 'bg-white shadow-sm text-slate-900 font-bold' : 'text-slate-600'}`}
            >
              {tab === 'registry' ? 'Model Registry & Canary' : tab === 'eval' ? 'Benchmark Eval Gate' : 'Model Drift Monitor'}
            </button>
          ))}
        </div>

        {activeTab === 'registry' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Registered Clinical Model Bindings</h3>
            {loadingModels ? <div className="p-8 text-center text-slate-500">Loading model telemetry…</div> : <DataTable columns={modelColumns} data={models} keyExtractor={(r) => r.id} />}
          </Card>
        )}

        {activeTab === 'eval' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Eval Gate Suite Verification (Candidate v4.0.0-exp)</h3>
            {loadingEvals ? <div className="p-8 text-center text-slate-500">Running benchmark evaluation test suite…</div> : <DataTable columns={evalColumns} data={evals} keyExtractor={(r) => r.id} />}
          </Card>
        )}

        {activeTab === 'drift' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Over-Time Output Drift & Grounding Stability</h3>
            {loadingDrift ? <div className="p-8 text-center text-slate-500">Loading drift monitoring metrics…</div> : <DataTable columns={driftColumns} data={drift} keyExtractor={(r) => r.week} />}
          </Card>
        )}
      </div>
    </div>
  )
}
