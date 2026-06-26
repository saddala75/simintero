import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAssignedAppeals, getOpenAppeals } from '../api/client'
import { AppShell } from '../components/AppShell'
import { AppealFilingModal } from '../components/AppealFilingModal'
import { useAuth, hasRole } from '../auth/AuthContext'
import type { AppealItem, AppealStatus } from '../types'

const STATUS_COLOR: Record<AppealStatus, string> = {
  filed: 'var(--amber)',
  assigned: 'var(--teal)',
  under_review: 'var(--teal)',
  decided: 'var(--pine)',
}

function AppealRow({
  item,
  navigate,
}: {
  item: AppealItem
  navigate: (path: string) => void
}) {
  const href = `/cases/${item.case_id}/appeals/${item.appeal_id}`
  return (
    <tr
      data-testid={`appeal-row-${item.appeal_id}`}
      onClick={() => navigate(href)}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') navigate(href) }}
    >
      <td>{item.member_name}</td>
      <td>
        <span className="en-cid">{item.case_id.slice(0, 8).toUpperCase()}</span>
      </td>
      <td>
        <span className="en-stbadge info">{item.category.replace(/_/g, ' ')}</span>
      </td>
      <td>{item.requested_outcome.replace(/_/g, ' ')}</td>
      <td>
        <span
          className="en-stbadge"
          style={{ backgroundColor: STATUS_COLOR[item.status], color: '#fff' }}
        >
          {item.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td>{item.days_open}d</td>
      <td className="en-go">→</td>
    </tr>
  )
}

export function AppealsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'assigned'
  const [filingOpen, setFilingOpen] = useState(false)

  const { data: assigned = [], isLoading } = useQuery({
    queryKey: ['appeals', 'assigned'],
    queryFn: getAssignedAppeals,
  })
  const { data: open = [] } = useQuery({
    queryKey: ['appeals', 'open'],
    queryFn: getOpenAppeals,
  })

  if (!hasRole(auth, 'appeals_coordinator')) {
    return (
      <AppShell breadcrumb={<b>Appeals</b>}>
        <div className="en-wrap">
          <p style={{ color: 'var(--ink-mut)', padding: '32px 0' }}>
            You do not have the appeals_coordinator role.
          </p>
        </div>
      </AppShell>
    )
  }

  const items = activeTab === 'assigned' ? assigned : open

  return (
    <AppShell breadcrumb={<b>Appeals</b>}>
      <div className="en-wrap">
        <div className="en-page-h">
          <div>
            <h1>Appeals</h1>
            <div className="sub">Appeal review · coordinator worklist</div>
          </div>
          <button
            className="en-act primary"
            onClick={() => setFilingOpen(true)}
            data-testid="btn-file-appeal-worklist"
          >
            File appeal
          </button>
        </div>

        <div className="en-queue">
          <div className="en-queue-h">
            {[
              { id: 'assigned', label: 'Assigned to me', count: assigned.length },
              { id: 'open', label: 'All open', count: open.length },
            ].map(tab => (
              <button
                key={tab.id}
                className={`en-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setSearchParams({ tab: tab.id })}
              >
                {tab.label} <span className="c">{tab.count}</span>
              </button>
            ))}
          </div>

          {isLoading && (
            <div style={{ padding: '32px 16px', color: 'var(--ink-mut)', fontSize: 13 }}>
              Loading appeals…
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <div style={{ padding: '32px 16px', color: 'var(--ink-mut)', fontSize: 13 }}>
              No appeals in this view.
            </div>
          )}
          {!isLoading && items.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Requested outcome</th>
                  <th>Status</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <AppealRow key={item.appeal_id} item={item} navigate={navigate} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filingOpen && (
          <AppealFilingModal
            onClose={() => setFilingOpen(false)}
            onFiled={(cid, aid) => {
              setFilingOpen(false)
              navigate(`/cases/${cid}/appeals/${aid}`)
            }}
          />
        )}
      </div>
    </AppShell>
  )
}
