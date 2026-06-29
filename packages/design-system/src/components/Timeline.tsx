// packages/design-system/src/components/Timeline.tsx
import React from 'react'

export interface TimelineItem {
  id: string
  title: string
  timestamp: string
  actor?: string
  description?: string
  badge?: React.ReactNode
}

export interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

export function Timeline({ items, className = '' }: TimelineProps) {
  return (
    <div className={`space-y-4 relative before:absolute before:inset-0 before:left-2 before:w-0.5 before:bg-slate-200 ${className}`}>
      {items.map((item) => (
        <div key={item.id} className="relative flex items-start gap-3 pl-6">
          <div className="absolute left-1 top-1.5 w-2.5 h-2.5 rounded-full bg-slate-900 ring-4 ring-white" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">{item.title}</span>
              {item.badge}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
              <span>{item.timestamp}</span>
              {item.actor && <span>· {item.actor}</span>}
            </div>
            {item.description && (
              <p className="text-xs text-slate-600 mt-1 bg-slate-50 p-2 rounded border border-slate-200/60">
                {item.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
