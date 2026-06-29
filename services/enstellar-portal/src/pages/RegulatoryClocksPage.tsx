import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { Card, SlaIndicator, Badge } from '@sim/design-system'
import { getWorklist } from '../api/client'

export function RegulatoryClocksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['worklist', 'clocks', 1],
    queryFn: () => getWorklist('default', 1),
    refetchInterval: 15_000,
  })

  const items = data?.items ?? []
  const clocks = items.filter((i) => i.sla != null)

  return (
    <AppShell breadcrumb={<b>Regulatory Clocks</b>}>
      <div className="max-w-[1320px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Regulatory SLA Clocks</h1>
            <p className="text-sm text-slate-500 mt-1">Live CMS / State regulatory compliance monitors</p>
          </div>
          <span className="font-mono text-xs px-3 py-1 bg-slate-900 text-emerald-400 rounded-full font-bold">
            Active Monitored: {clocks.length}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading clock telemetry…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clocks.map((item) => {
              const hours = item.sla?.hours_remaining ?? 0
              const isBreached = item.sla?.rag === 'red'
              return (
                <Card key={item.case_id} className="p-5 border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs font-bold text-slate-700">
                      PA-{item.case_id.replace(/-/g, '').slice(0, 8).toUpperCase()}
                    </span>
                    {(() => {
                      const BADGE_STATUS_MAP: Record<string, 'approved' | 'denied' | 'pending' | 'in_review' | 'breached' | 'filed' | 'pended'> = {
                        approved: 'approved',
                        denied: 'denied',
                        partially_denied: 'denied',
                        adverse_modification: 'denied',
                        clinical_review: 'in_review',
                        md_review: 'pending',
                        pend_rfi: 'pended',
                      }
                      const statusKey = BADGE_STATUS_MAP[item.status] ?? 'pending'
                      return <Badge variant="status" status={statusKey} label={item.status.replace(/_/g, ' ')} />
                    })()}
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm mb-1">{item.service_description}</h3>
                  <p className="text-xs text-slate-500 mb-4">{item.member_name} · {item.lob.replace(/_/g, ' ')}</p>
                  
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-500">Urgency: {item.urgency}</span>
                    <SlaIndicator hoursRemaining={hours} totalHours={72} breached={isBreached} />
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
