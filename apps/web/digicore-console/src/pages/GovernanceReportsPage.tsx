import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Badge } from '@sim/design-system'

export function GovernanceReportsPage() {
  const navigate = useNavigate()
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const handleExport = (format: 'CSV' | 'PDF') => {
    setExportMessage(`Generated and exported Governance Compliance Report as ${format}!`)
  }

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {exportMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex items-center justify-between">
            <span>✓ {exportMessage}</span>
            <button onClick={() => setExportMessage(null)} className="font-bold text-xs">✕</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              ← Back to Registry
            </Button>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Governance & Policy Reports</h1>
              <p className="text-sm text-slate-500 mt-1">CMS / State regulatory compliance audit metrics and rule performance</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleExport('CSV')}>
              Export CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => handleExport('PDF')}>
              Export Governance PDF Report
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-5">
            <div className="text-3xl font-black text-slate-900">48</div>
            <div className="text-xs text-slate-500 mt-1">Active Coverage Rules</div>
          </Card>
          <Card className="p-5">
            <div className="text-3xl font-black text-emerald-700">99.4%</div>
            <div className="text-xs text-slate-500 mt-1">Regulatory SLA Compliance</div>
          </Card>
          <Card className="p-5">
            <div className="text-3xl font-black text-blue-600">100%</div>
            <div className="text-xs text-slate-500 mt-1">Adverse Human Signoff</div>
          </Card>
          <Card className="p-5">
            <div className="text-3xl font-black text-slate-900">12</div>
            <div className="text-xs text-slate-500 mt-1">Rule Revisions This Quarter</div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">Approval Cycle Time Distribution (Days)</h3>
            <div className="space-y-4 pt-2">
              {[
                { label: 'Coverage Rules (Fast Track)', val: 1.2, pct: 25, color: 'bg-emerald-600' },
                { label: 'CQL Clinical Libraries', val: 3.4, pct: 60, color: 'bg-blue-600' },
                { label: 'ValueSet Artifacts', val: 0.8, pct: 15, color: 'bg-indigo-600' },
              ].map((item) => (
                <div key={item.label} className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-700 font-medium">
                    <span>{item.label}</span>
                    <span className="font-mono font-bold">{item.val} days avg</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">Top Fired Clinical Rules (Last 30 Days)</h3>
            <div className="space-y-3">
              {[
                { rule: 'POL-001 (Lumbar Spine MRI)', count: '1,420 determinations', rate: '78% Auto-Approved' },
                { rule: 'POL-004 (Bariatric Surgery CQL)', count: '850 determinations', rate: '64% Auto-Approved' },
                { rule: 'POL-002 (Physical Therapy Evaluation)', count: '2,100 determinations', rate: '92% Auto-Approved' },
              ].map((r) => (
                <div key={r.rule} className="flex items-center justify-between p-3 bg-slate-50 rounded-md border border-slate-200 text-sm">
                  <span className="font-semibold text-slate-900">{r.rule}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-slate-600">{r.count}</span>
                    <Badge variant="status" status="approved" label={r.rate} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
