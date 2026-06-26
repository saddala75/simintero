import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAssignedGrievances } from '../api/client'
import type { GrievanceItem, GrievanceStatus } from '../types'
import { GrievanceFilingModal } from '../components/GrievanceFilingModal'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'

const STATUS_COLOR: Record<GrievanceStatus, string> = {
  filed: '#b45309',
  acknowledged: '#1d4ed8',
  investigating: '#7c3aed',
  resolved: '#15803d',
}

function GrievanceRow({ item }: { item: GrievanceItem }) {
  const navigate = useNavigate()
  return (
    <tr
      className="en-queue-row"
      data-testid={`grievance-row-${item.grievance_id}`}
      onClick={() => navigate(`/grievances/${item.grievance_id}`)}
      style={{ cursor: 'pointer' }}
    >
      <td className="en-queue-cell">{item.member_ref ?? '—'}</td>
      <td className="en-queue-cell">{item.category ?? '—'}</td>
      <td className="en-queue-cell">{item.urgency}</td>
      <td className="en-queue-cell">
        <span className="en-status-chip" style={{ background: STATUS_COLOR[item.status] }}>
          {item.status}
        </span>
      </td>
      <td className="en-queue-cell">{item.filed_at ? new Date(item.filed_at).toLocaleDateString() : '—'}</td>
      <td className="en-queue-cell">{item.resolution_due_at ? new Date(item.resolution_due_at).toLocaleDateString() : '—'}</td>
    </tr>
  )
}

export function GrievancesPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [filingOpen, setFilingOpen] = useState(false)

  const { data: assigned = [], isLoading, isError } = useQuery({
    queryKey: ['grievances', 'assigned'],
    queryFn: getAssignedGrievances,
    staleTime: 60_000,
    enabled: auth.authenticated,
  })

  return (
    <AppShell>
      <div className="en-page">
        <header className="en-page-header">
          <h1 className="en-page-title">Grievances</h1>
          <button
            className="en-btn en-btn--primary"
            data-testid="btn-file-grievance-worklist"
            onClick={() => setFilingOpen(true)}
          >
            File grievance
          </button>
        </header>

        <div className="en-tabs">
          <button className="en-tab active">Assigned to me</button>
        </div>

        {isLoading && <p className="en-loading">Loading…</p>}
        {isError && <p className="en-error-text">Failed to load grievances.</p>}

        {!isLoading && !isError && (
          <table className="en-queue-table">
            <thead>
              <tr>
                <th className="en-queue-th">Member</th>
                <th className="en-queue-th">Category</th>
                <th className="en-queue-th">Urgency</th>
                <th className="en-queue-th">Status</th>
                <th className="en-queue-th">Filed</th>
                <th className="en-queue-th">Due</th>
              </tr>
            </thead>
            <tbody>
              {assigned.map(item => (
                <GrievanceRow key={item.grievance_id} item={item} />
              ))}
              {assigned.length === 0 && (
                <tr>
                  <td colSpan={6} className="en-queue-empty">No assigned grievances.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {filingOpen && (
          <GrievanceFilingModal
            onClose={() => setFilingOpen(false)}
            onFiled={(grievanceId) => {
              setFilingOpen(false)
              navigate(`/grievances/${grievanceId}`)
            }}
          />
        )}
      </div>
    </AppShell>
  )
}
