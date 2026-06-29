import { useQuery } from '@tanstack/react-query'
import { SlaIndicator } from '@sim/design-system'
import { getWorklist } from '../api/client'

export interface RegulatoryCountdownBannerProps {
  urgentCasesCount?: number
  shortestSlaHours?: number
  className?: string
}

export function RegulatoryCountdownBanner({
  urgentCasesCount: propUrgent,
  shortestSlaHours: propShortest,
  className = '',
}: RegulatoryCountdownBannerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['worklist', 'default', 1],
    queryFn: () => getWorklist('default', 1),
    staleTime: 15_000,
  })

  if (isLoading && propUrgent === undefined && propShortest === undefined) {
    return (
      <div className={`bg-slate-900 text-white px-4 py-2.5 text-xs flex items-center justify-between border-b border-slate-800 animate-pulse ${className}`}>
        <div className="flex items-center gap-3">
          <div className="h-3 w-40 bg-slate-800 rounded" />
          <div className="h-3 w-64 bg-slate-800 rounded" />
        </div>
        <div className="h-4 w-32 bg-slate-800 rounded" />
      </div>
    )
  }

  const items = data?.items ?? []
  const activeSlas = items
    .filter((i) => i.sla != null && !i.sla.paused)
    .map((i) => i.sla!.hours_remaining)

  const liveUrgentCount = items.filter(
    (i) => i.sla != null && !i.sla.paused && i.sla.hours_remaining <= 24
  ).length

  const liveShortestHours = activeSlas.length > 0 ? Math.min(...activeSlas) : 48

  const urgentCasesCount = propUrgent ?? liveUrgentCount
  const shortestSlaHours = propShortest ?? Math.round(liveShortestHours)
  const isBreached = shortestSlaHours <= 0

  return (
    <div
      className={`bg-slate-900 text-white px-4 py-2 text-xs flex items-center justify-between border-b border-slate-800 ${className}`}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-semibold tracking-wide text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          REGULATORY SLA MONITOR
        </span>
        <span className="text-slate-300">
          {urgentCasesCount} prior auth {urgentCasesCount === 1 ? 'case requires' : 'cases require'} determination within upcoming window
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-slate-400 font-mono text-[11px]">Next SLA Deadline:</span>
        <SlaIndicator hoursRemaining={shortestSlaHours} totalHours={72} breached={isBreached} />
      </div>
    </div>
  )
}
