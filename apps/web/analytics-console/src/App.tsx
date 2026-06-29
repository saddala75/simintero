import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUmMetrics, getOperationalMetrics, getComplianceReports, type UmMetric, type OperationalMetric, type ComplianceReport } from './api/client'
import { Card, Badge, DataTable, type Column } from '@sim/design-system'

export default function App() {
  const [activeTab, setActiveTab] = useState<'um' | 'ops' | 'compliance'>('um')

  const { data: umMetrics = [], isLoading: loadingUm } = useQuery({ queryKey: ['um-metrics'], queryFn: getUmMetrics })
  const { data: opsMetrics = [], isLoading: loadingOps } = useQuery({ queryKey: ['ops-metrics'], queryFn: getOperationalMetrics })
  const { data: complianceReports = [], isLoading: loadingCompliance } = useQuery({ queryKey: ['compliance-reports'], queryFn: getComplianceReports })

  const umColumns: Column<UmMetric>[] = [
    { key: 'lob', header: 'Line of Business', render: (r) => <span className="font-bold text-slate-900">{r.lob}</span> },
    { key: 'approvalRate', header: 'Approval Rate', render: (r) => <Badge variant="status" status="approved" label={`${r.approvalRate}%`} /> },
    { key: 'denialRate', header: 'Denial Rate', render: (r) => <span className="font-mono text-xs font-bold text-red-700">{r.denialRate}%</span> },
    { key: 'overturnRate', header: 'Appeal Overturn Rate', render: (r) => <span className="font-mono text-xs font-bold text-amber-700">{r.overturnRate}%</span> },
    { key: 'avgDecisionHours', header: 'Avg Decision Time', render: (r) => <span className="font-mono text-xs font-bold text-slate-800">{r.avgDecisionHours} hours</span> },
  ]

  const opsColumns: Column<OperationalMetric>[] = [
    { key: 'metric', header: 'Operational Telemetry Metric', render: (r) => <span className="font-bold text-slate-900">{r.metric}</span> },
    { key: 'currentValue', header: 'Current Value', render: (r) => <span className="font-mono text-xs font-bold text-blue-700">{r.currentValue}</span> },
    { key: 'trend', header: 'Trend / Variance', render: (r) => <span className="font-mono text-xs font-semibold text-slate-600">{r.trend}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant="status" status={r.status === 'optimal' ? 'approved' : 'pending'} label={r.status.toUpperCase()} /> },
  ]

  const complianceColumns: Column<ComplianceReport>[] = [
    { key: 'period', header: 'Reporting Period', render: (r) => <span className="font-bold text-slate-900">{r.period}</span> },
    { key: 'slaCompliancePct', header: 'CMS Regulatory SLA Adherence', render: (r) => <Badge variant="status" status="approved" label={`${r.slaCompliancePct}%`} /> },
    { key: 'breachesCount', header: 'SLA Breaches', render: (r) => <span className="font-mono text-xs font-bold text-red-700">{r.breachesCount} breaches</span> },
    { key: 'noticeTimelinessPct', header: 'Notice Timeliness Adherence', render: (r) => <span className="font-mono text-xs font-bold text-emerald-700">{r.noticeTimelinessPct}%</span> },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Simintero Executive Analytics Console</h1>
          <p className="text-sm text-slate-500 mt-1">Utilization Management, Operational Efficiency & Regulatory Compliance Reports</p>
        </div>

        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit text-xs font-semibold">
          {(['um', 'ops', 'compliance'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md capitalize transition-colors ${activeTab === tab ? 'bg-white shadow-sm text-slate-900 font-bold' : 'text-slate-600'}`}
            >
              {tab === 'um' ? 'UM Performance' : tab === 'ops' ? 'Operational Metrics' : 'Regulatory Compliance Reports'}
            </button>
          ))}
        </div>

        {activeTab === 'um' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Utilization Management Performance by LOB</h3>
            {loadingUm ? <div className="p-8 text-center text-slate-500">Loading metrics…</div> : <DataTable columns={umColumns} data={umMetrics} keyExtractor={(r) => r.lob} />}
          </Card>
        )}

        {activeTab === 'ops' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Operational Queue & AI Utilization Metrics</h3>
            {loadingOps ? <div className="p-8 text-center text-slate-500">Loading telemetry…</div> : <DataTable columns={opsColumns} data={opsMetrics} keyExtractor={(r) => r.metric} />}
          </Card>
        )}

        {activeTab === 'compliance' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Regulatory SLA Compliance & Notice Audit History</h3>
            {loadingCompliance ? <div className="p-8 text-center text-slate-500">Loading compliance history…</div> : <DataTable columns={complianceColumns} data={complianceReports} keyExtractor={(r) => r.period} />}
          </Card>
        )}
      </div>
    </div>
  )
}
