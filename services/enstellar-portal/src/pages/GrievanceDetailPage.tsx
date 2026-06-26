import { useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getGrievanceDetail, acknowledgeGrievance, assignInvestigator } from '../api/client'
import type { GrievanceDetail } from '../types'
import { GrievanceResolutionForm } from '../components/GrievanceResolutionForm'
import type { GrievanceFormReadiness } from '../components/GrievanceResolutionForm'
import { AppShell } from '../components/AppShell'
import { useAuth, hasRole } from '../auth/AuthContext'

function GrievanceContextColumn({ detail }: { detail: GrievanceDetail }) {
  return (
    <div className="en-col ctx">
      <section className="en-ctx-section">
        <h3 className="en-ctx-heading">Member</h3>
        <p className="en-ctx-value">{detail.member_ref ?? '—'}</p>
      </section>
      {detail.case_id && (
        <section className="en-ctx-section">
          <h3 className="en-ctx-heading">Case ID</h3>
          <p className="en-ctx-value">{detail.case_id}</p>
        </section>
      )}
      <section className="en-ctx-section">
        <h3 className="en-ctx-heading">Category</h3>
        <p className="en-ctx-value">{detail.category ?? '—'}</p>
      </section>
      <section className="en-ctx-section">
        <h3 className="en-ctx-heading">Urgency</h3>
        <p className="en-ctx-value">{detail.urgency}</p>
      </section>
      {detail.lob && (
        <section className="en-ctx-section">
          <h3 className="en-ctx-heading">LOB</h3>
          <p className="en-ctx-value">{detail.lob}</p>
        </section>
      )}
      <section className="en-ctx-section">
        <h3 className="en-ctx-heading">Filed by</h3>
        <p className="en-ctx-value">{detail.filed_by}</p>
      </section>
      <section className="en-ctx-section">
        <h3 className="en-ctx-heading">Filed</h3>
        <p className="en-ctx-value">{new Date(detail.filed_at).toLocaleDateString()}</p>
      </section>
      {detail.resolution_due_at && (
        <section className="en-ctx-section">
          <h3 className="en-ctx-heading">Due</h3>
          <p className="en-ctx-value">{new Date(detail.resolution_due_at).toLocaleDateString()}</p>
        </section>
      )}
    </div>
  )
}

function GrievanceWorkColumn({
  detail,
  submitRef,
  onReadinessChange,
  onComplete,
  isAssignedToMe,
}: {
  detail: GrievanceDetail
  submitRef: React.RefObject<{ submit: () => void } | null>
  onReadinessChange: (s: GrievanceFormReadiness) => void
  onComplete: () => void
  isAssignedToMe: boolean
}) {
  return (
    <div className="en-col work">
      <section className="en-work-section">
        <h3 className="en-work-heading">Description</h3>
        <p className="en-work-body">{detail.description ?? 'No description provided.'}</p>
      </section>

      {detail.status === 'acknowledged' && detail.acknowledged_by && (
        <section className="en-work-section">
          <h3 className="en-work-heading">Acknowledged by</h3>
          <p className="en-work-body">{detail.acknowledged_by}</p>
        </section>
      )}

      {(detail.status === 'investigating' || detail.status === 'resolved') && detail.assigned_to && (
        <section className="en-work-section">
          <h3 className="en-work-heading">Assigned investigator</h3>
          <p className="en-work-body">{detail.assigned_to}</p>
        </section>
      )}

      {detail.status === 'resolved' && detail.resolution && (
        <section className="en-work-section">
          <h3 className="en-work-heading">Resolution</h3>
          <p className="en-work-body">{detail.resolution}</p>
        </section>
      )}

      {detail.status === 'investigating' && isAssignedToMe && (
        <section className="en-work-section">
          <h3 className="en-work-heading">Resolve grievance</h3>
          <GrievanceResolutionForm
            grievanceId={detail.grievance_id}
            onComplete={onComplete}
            onReadinessChange={onReadinessChange}
            submitRef={submitRef}
          />
        </section>
      )}
    </div>
  )
}

function GrievanceGateColumn({
  detail,
  grievanceFormState,
  isAssignedToMe,
  isCoordinator,
  onAcknowledge,
  onAssign,
  ackPending,
  assignPending,
  submitRef,
}: {
  detail: GrievanceDetail
  grievanceFormState: GrievanceFormReadiness
  isAssignedToMe: boolean
  isCoordinator: boolean
  onAcknowledge: () => void
  onAssign: () => void
  ackPending: boolean
  assignPending: boolean
  submitRef: React.RefObject<{ submit: () => void } | null>
}) {
  const { status } = detail
  const gateItems = [
    { label: 'Grievance filed', done: true },
    { label: 'Acknowledged', done: status !== 'filed' },
    { label: 'Investigator assigned', done: status === 'investigating' || status === 'resolved' },
    { label: 'Resolution written', done: grievanceFormState.resolutionWritten },
    { label: 'Resolved', done: status === 'resolved' },
  ]
  const doneCnt = gateItems.filter(g => g.done).length
  const pct = Math.round((doneCnt / gateItems.length) * 100)

  return (
    <div className="en-col gate">
      <div className="en-gate-card">
        <h3 className="en-gate-title">Progress</h3>
        <div className="en-gate-progress-bar">
          <div className="en-gate-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <ul className="en-gate-list">
          {gateItems.map(item => (
            <li key={item.label} className={`en-gate-item${item.done ? ' done' : ''}`}>
              <span className="en-gate-check">{item.done ? '✓' : '○'}</span>
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="en-gate-actions">
        {status === 'filed' && isCoordinator && (
          <button
            className="en-btn en-btn--primary"
            data-testid="btn-acknowledge-grievance"
            onClick={onAcknowledge}
            disabled={ackPending}
          >
            {ackPending ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        )}

        {status === 'acknowledged' && isCoordinator && (
          <button
            className="en-btn en-btn--primary"
            data-testid="btn-assign-grievance"
            onClick={onAssign}
            disabled={assignPending}
          >
            {assignPending ? 'Assigning…' : 'Assign to me'}
          </button>
        )}

        {status === 'investigating' && isAssignedToMe && (
          <button
            className="en-btn en-btn--primary"
            data-testid="btn-resolve-grievance"
            disabled={!grievanceFormState.resolutionWritten}
            onClick={() => submitRef.current?.submit()}
          >
            Resolve grievance
          </button>
        )}
      </div>
    </div>
  )
}

export function GrievanceDetailPage() {
  const { grievanceId } = useParams<{ grievanceId: string }>()
  const auth = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submitRef = useRef<{ submit: () => void } | null>(null)

  const [grievanceFormState, setGrievanceFormState] = useState<GrievanceFormReadiness>({
    resolutionWritten: false,
  })

  const handleGrievanceReadinessChange = useCallback(
    (s: GrievanceFormReadiness) => setGrievanceFormState(s),
    [],
  )

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['grievance', grievanceId],
    queryFn: () => getGrievanceDetail(grievanceId!),
    staleTime: 60_000,
    enabled: !!grievanceId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['grievance', grievanceId] })

  const ackMut = useMutation({
    mutationFn: () => acknowledgeGrievance(grievanceId!),
    onSuccess: invalidate,
  })

  const assignMut = useMutation({
    mutationFn: () => assignInvestigator(grievanceId!, auth.sub ?? ''),
    onSuccess: invalidate,
  })

  if (!auth.authenticated) return null

  if (isLoading) {
    return (
      <AppShell>
        <p className="en-loading">Loading…</p>
      </AppShell>
    )
  }

  if (isError || !detail) {
    return (
      <AppShell>
        <p className="en-error-text">Failed to load grievance.</p>
      </AppShell>
    )
  }

  const isCoordinator = hasRole(auth, 'grievance_coordinator')
  const isAssignedToMe = detail.assigned_to === auth.sub
  const resolutionDone = detail.status === 'resolved'

  return (
    <AppShell>
      <div className="en-case-workspace">
        <header className="en-workspace-header">
          <h1 className="en-workspace-title">Grievance</h1>
          <span className="en-workspace-id">{detail.grievance_id}</span>
        </header>

        {resolutionDone && (
          <div className="en-resolved-banner">
            <span className="ib-t">Grievance resolved</span>
            {detail.resolved_at && (
              <span className="ib-meta">
                Resolved on {new Date(detail.resolved_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        <div className="en-three-col">
          <GrievanceContextColumn detail={detail} />
          <GrievanceWorkColumn
            detail={detail}
            submitRef={submitRef}
            onReadinessChange={handleGrievanceReadinessChange}
            onComplete={invalidate}
            isAssignedToMe={isAssignedToMe}
          />
          <GrievanceGateColumn
            detail={detail}
            grievanceFormState={grievanceFormState}
            isAssignedToMe={isAssignedToMe}
            isCoordinator={isCoordinator}
            onAcknowledge={() => ackMut.mutate()}
            onAssign={() => assignMut.mutate()}
            ackPending={ackMut.isPending}
            assignPending={assignMut.isPending}
            submitRef={submitRef}
          />
        </div>

        <button className="en-btn en-btn--ghost" onClick={() => navigate('/grievances')}>
          ← Back to grievances
        </button>
      </div>
    </AppShell>
  )
}
