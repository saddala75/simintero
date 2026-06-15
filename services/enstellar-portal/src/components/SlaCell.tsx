import type { SlaInfo } from '../types'

const COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
}

interface Props {
  sla: SlaInfo | null
}

export function SlaCell({ sla }: Props) {
  if (!sla) {
    return <span>—</span>
  }
  const h = Math.round(sla.hours_remaining)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-label={`SLA ${sla.rag}`}
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: COLOR[sla.rag],
          flexShrink: 0,
        }}
      />
      {h}h
    </span>
  )
}
