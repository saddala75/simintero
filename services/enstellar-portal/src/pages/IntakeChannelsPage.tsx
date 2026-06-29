import { AppShell } from '../components/AppShell'
import { Card, Badge } from '@sim/design-system'

export function IntakeChannelsPage() {
  const channels = [
    { name: 'FHIR PAS API ($submit)', protocol: 'REST / FHIR R4', volume: '1,240 cases/day', status: 'operational', lat: '120ms' },
    { name: 'X12 EDI 278 Batch Intake', protocol: 'SFTP / X12 005010', volume: '3,850 cases/day', status: 'operational', lat: '1.2s' },
    { name: 'Provider Portal (Manual Submission)', protocol: 'HTTPS / Web Form', volume: '450 cases/day', status: 'operational', lat: '45ms' },
    { name: 'Fax & Unstructured Document Intake', protocol: 'OCR / NLP Pipeline', volume: '180 cases/day', status: 'degraded', lat: '4.5s' },
  ]

  return (
    <AppShell breadcrumb={<b>Multi-Channel Intake</b>}>
      <div className="max-w-[1320px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Multi-Channel Intake Pipeline</h1>
            <p className="text-sm text-slate-500 mt-1">Real-time ingestion health across FHIR, X12 EDI, Portal, and Document OCR</p>
          </div>
          <span className="font-mono text-xs px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-full font-bold">
            STAGED DEMO TELEMETRY STUB
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {channels.map((ch) => (
            <Card key={ch.name} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{ch.name}</h3>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">{ch.protocol}</p>
                </div>
                <Badge
                  variant="status"
                  status={ch.status === 'operational' ? 'approved' : 'pending'}
                  label={ch.status.toUpperCase()}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500 block">Daily Ingestion Volume</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">{ch.volume}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Avg Ingestion Latency</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">{ch.lat}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
