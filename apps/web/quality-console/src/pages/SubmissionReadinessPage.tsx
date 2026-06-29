import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getSubmissionReadiness, lockSubmissionPackage, type SubmissionReadinessItem } from '../api/client'
import { Card, Badge, Button, DataTable, type Column } from '@sim/design-system'

export function SubmissionReadinessPage() {
  const navigate = useNavigate()
  const [lockResult, setLockResult] = useState<string | null>(null)

  const { data: readiness = [], isLoading } = useQuery({
    queryKey: ['submission-readiness'],
    queryFn: getSubmissionReadiness,
  })

  const lockMut = useMutation({
    mutationFn: lockSubmissionPackage,
    onSuccess: (res) => {
      setLockResult(`Pre-submission audit package ${res.packageId} locked and generated for CMS transmission! Compliance validation logged.`)
    },
  })

  const columns: Column<SubmissionReadinessItem>[] = [
    {
      key: 'measureCode',
      header: 'Measure Code',
      render: (row) => <span className="font-mono text-xs font-bold text-slate-900">{row.measureCode}</span>,
    },
    {
      key: 'measureName',
      header: 'Measure Name',
      render: (row) => <span className="font-semibold text-slate-900 text-sm">{row.measureName}</span>,
    },
    {
      key: 'auditStatus',
      header: 'Pre-Audit Validation',
      render: (row) => {
        const mapped = row.auditStatus === 'passed' ? 'approved' : row.auditStatus === 'warning' ? 'pending' : 'denied'
        return <Badge variant="status" status={mapped} label={row.auditStatus.toUpperCase()} />
      },
    },
    {
      key: 'dataQualityFlags',
      header: 'Data Quality Flags',
      render: (row) => (
        <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${row.dataQualityFlags === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {row.dataQualityFlags} Flags
        </span>
      ),
    },
    {
      key: 'readyForSubmission',
      header: 'Submission Readiness',
      render: (row) => (
        <span className={`font-mono text-xs font-bold ${row.readyForSubmission ? 'text-emerald-700' : 'text-red-700'}`}>
          {row.readyForSubmission ? '✓ SUBMISSION READY' : '✕ HOLD FOR AUDIT'}
        </span>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {lockResult && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-md text-sm text-emerald-900 font-semibold flex items-center justify-between">
            <span>✓ {lockResult}</span>
            <button onClick={() => setLockResult(null)} className="font-bold text-xs">✕ Dismiss</button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              ← Back to Measures
            </Button>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Pre-Submission Audit Readiness</h1>
              <p className="text-sm text-slate-500 mt-1">HEDIS / CMS Stars final data validation checks & submission status</p>
            </div>
          </div>
          <Button
            variant="primary"
            loading={lockMut.isPending}
            onClick={() => lockMut.mutate()}
          >
            Lock & Generate Submission Package
          </Button>
        </div>

        <Card className="p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">Regulatory Audit Verification Status</h3>
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Loading readiness verification…</div>
          ) : (
            <DataTable columns={columns} data={readiness} keyExtractor={(row) => row.id} />
          )}
        </Card>
      </div>
    </div>
  )
}
