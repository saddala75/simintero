// packages/design-system/src/components/Card.tsx
import React from 'react'
import { colors, radius, shadows } from '../tokens'
import { Button } from './Button'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
  className?: string
}

export function Card({ children, className = '', style, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={`border border-slate-200 shadow-card p-4 ${className}`}
      style={{
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.card,
        boxShadow: shadows.card,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export interface EvidenceCardProps {
  title: string
  confidence: number
  citationCount: number
  onAccept?: () => void
  onReject?: () => void
  className?: string
}

export function EvidenceCard({
  title,
  confidence,
  citationCount,
  onAccept,
  onReject,
  className = '',
}: EvidenceCardProps) {
  const pct = Math.round(confidence * 100)
  const confColor = confidence >= 0.8 ? colors.complianceGreen : colors.warning

  return (
    <div className={`flex items-start gap-3 p-3 rounded-md border border-slate-200 bg-[#E8F0FE]/20 ${className}`}>
      <span className="shrink-0 text-lg select-none" style={{ color: colors.intelligenceBlue }}>✦</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug" style={{ color: colors.ink }}>{title}</p>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
          <span>{citationCount} {citationCount === 1 ? 'citation' : 'citations'}</span>
          <span>·</span>
          <span className="font-mono font-semibold" style={{ color: confColor }}>
            {pct}% confidence
          </span>
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0 ml-2">
        {onAccept && (
          <Button variant="ghost" size="sm" onClick={onAccept}>
            Accept
          </Button>
        )}
        {onReject && (
          <Button variant="ghost" size="sm" onClick={onReject}>
            Reject
          </Button>
        )}
      </div>
    </div>
  )
}
