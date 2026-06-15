import type { CaseDetail } from '../types'

interface Props {
  caseDetail: CaseDetail
}

const STATUS_COLOR: Record<string, string> = {
  clinical_review: '#d97706',
  approved: '#16a34a',
  denied: '#dc2626',
  partially_denied: '#dc2626',
  adverse_modification: '#dc2626',
  intake: '#6b7280',
  completeness_check: '#6b7280',
  auto_determination: '#6b7280',
  pend_rfi: '#2563eb',
  withdrawn: '#6b7280',
  closed: '#6b7280',
}

export function CaseHeader({ caseDetail }: Props) {
  const memberName =
    typeof caseDetail.member.name === 'string' ? caseDetail.member.name : 'Unknown'
  const statusColor = STATUS_COLOR[caseDetail.status] ?? '#6b7280'

  return (
    <div data-testid="case-header" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
      <h2 style={{ margin: 0 }}>{memberName}</h2>
      <p style={{ margin: '4px 0', color: '#6b7280', fontSize: 12 }}>
        Case ID: {caseDetail.case_id}
      </p>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: statusColor,
          color: '#fff',
          fontSize: 12,
          marginRight: 8,
        }}
      >
        {caseDetail.status.replace(/_/g, ' ')}
      </span>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: caseDetail.urgency === 'urgent' ? '#dc2626' : '#6b7280',
          color: '#fff',
          fontSize: 12,
        }}
      >
        {caseDetail.urgency}
      </span>
    </div>
  )
}
