import { colors } from '../tokens'

export type RuleBadgeProps = {
  variant: 'rule'
  label: string
  className?: string
}

export type StatusBadgeProps = {
  variant: 'status'
  status: 'approved' | 'denied' | 'pending' | 'in_review' | 'breached' | 'filed' | 'pended'
  label?: string
  className?: string
}

export type BadgeProps = RuleBadgeProps | StatusBadgeProps

const STATUS_MAP: Record<StatusBadgeProps['status'], { label: string; bg: string; text: string }> = {
  approved:  { label: 'Approved',  bg: '#E6F4EE', text: colors.complianceGreen },
  denied:    { label: 'Denied',    bg: '#FDECEA', text: colors.error },
  pending:   { label: 'Pending',   bg: '#FFF7E6', text: colors.warning },
  in_review: { label: 'In Review', bg: '#E8F0FE', text: colors.intelligenceBlue },
  breached:  { label: 'Breached',  bg: '#FDECEA', text: colors.error },
  filed:     { label: 'Filed',     bg: '#F0F4F8', text: '#4A5568' },
  pended:    { label: 'Pended (RFI)', bg: '#FFF7E6', text: colors.warning },
}

export function Badge(props: BadgeProps) {
  if (props.variant === 'rule') {
    return (
      <span
        data-variant="rule"
        className={`font-mono text-xs font-medium px-2 py-0.5 rounded bg-slate-900 text-white tracking-wide inline-flex items-center ${props.className || ''}`}
      >
        {props.label}
      </span>
    )
  }

  const statusInfo = STATUS_MAP[props.status] || { label: props.status, bg: '#F0F4F8', text: '#4A5568' }
  const displayLabel = props.label || statusInfo.label

  return (
    <span
      data-variant="status"
      style={{ backgroundColor: statusInfo.bg, color: statusInfo.text }}
      className={`text-xs font-semibold px-2 py-0.5 rounded-md inline-flex items-center ${props.className || ''}`}
    >
      {displayLabel}
    </span>
  )
}
