import { colors } from '../tokens'

export interface SlaIndicatorProps {
  hoursRemaining: number
  totalHours: number
  breached?: boolean
  className?: string
}

export function SlaIndicator({ hoursRemaining, totalHours, breached, className = '' }: SlaIndicatorProps) {
  const pct = Math.max(0, Math.min(100, (hoursRemaining / Math.max(1, totalHours)) * 100))
  const color = breached
    ? colors.error
    : pct < 25
    ? colors.warning
    : colors.complianceGreen

  return (
    <div data-testid="sla-bar" className={`flex items-center gap-2 ${className}`}>
      <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden shrink-0">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${breached ? 100 : pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono font-medium shrink-0" style={{ color }}>
        {breached ? 'BREACHED' : `${hoursRemaining}h`}
      </span>
    </div>
  )
}
