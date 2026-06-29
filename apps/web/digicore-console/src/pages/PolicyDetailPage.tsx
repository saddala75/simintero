import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { getArtifactById, rollbackArtifact } from '../api/client'
import { Card, Badge, Button, Timeline, type TimelineItem } from '@sim/design-system'

export function PolicyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: artifact, isLoading, isFetched } = useQuery({
    queryKey: ['artifact', id],
    queryFn: () => getArtifactById(id || 'POL-001'),
  })

  const [selectedVersion, setSelectedVersion] = useState<string>('')
  const [showDiff, setShowDiff] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  useEffect(() => {
    if (artifact?.version) {
      setSelectedVersion(artifact.version)
    }
  }, [artifact])

  const rollbackMut = useMutation({
    mutationFn: () => rollbackArtifact(id || 'POL-001', selectedVersion),
    onSuccess: () => {
      setActionMessage(`Successfully triggered rollback of ${id} to version ${selectedVersion}!`)
      queryClient.invalidateQueries({ queryKey: ['artifact', id] })
    },
  })

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading policy detail…</div>
  }

  if (isFetched && !artifact) {
    return (
      <div className="min-h-screen bg-[#F7F9FB] p-12">
        <Card className="max-w-md mx-auto p-8 text-center space-y-4">
          <div className="text-xl font-bold text-slate-900">Policy Artifact Not Found</div>
          <p className="text-xs text-slate-500">No VKAS coverage rule or CQL library exists for ID "{id}".</p>
          <Button variant="primary" onClick={() => navigate('/')}>
            Return to Registry
          </Button>
        </Card>
      </div>
    )
  }

  const policyName = artifact?.name ?? ''
  const currentVersion = artifact?.version ?? 'v1.0.0'
  const versions = artifact?.history ?? [
    {
      version: currentVersion,
      title: `${currentVersion} Active`,
      timestamp: artifact?.updated_at ?? '2026-06-15',
      actor: 'System Administrator',
      description: 'Initial release',
      cql: artifact?.cql ?? '',
    },
  ]

  const activeVersionIndex = versions.findIndex((v) => v.version === selectedVersion)
  const activeVersionData = versions[activeVersionIndex >= 0 ? activeVersionIndex : 0]
  const priorVersionData = versions[activeVersionIndex + 1] ?? versions[versions.length - 1]

  const timelineItems: TimelineItem[] = versions.map((v) => ({
    id: v.version,
    title: v.title,
    timestamp: v.timestamp,
    actor: v.actor,
    description: v.description,
    badge: <Badge variant="status" status={v.version === currentVersion ? 'approved' : 'filed'} label={v.version === currentVersion ? 'ACTIVE' : 'HISTORICAL'} />,
  }))

  const displayedCql = activeVersionData?.cql || artifact?.cql || '// No CQL source available'
  const priorCql = priorVersionData?.cql || '// No prior version available'

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {actionMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex items-center justify-between">
            <span>✓ {actionMessage}</span>
            <button onClick={() => setActionMessage(null)} className="font-bold text-xs">✕</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              ← Back to Registry
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-slate-900">{artifact?.id} · {policyName}</h1>
                <Badge variant="status" status={artifact?.status === 'active' ? 'approved' : 'pending'} label={artifact?.status.toUpperCase()} />
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">VKAS Artifact URI: urn:simintero:policy:{artifact?.id.toLowerCase()}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-2">
              Select Version:
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded font-mono text-xs bg-white font-semibold"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version} ({v.version === currentVersion ? 'Current' : 'Historical'})
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" size="sm" onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? 'Hide Version Diff' : 'View Version Diff'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={rollbackMut.isPending}
              onClick={() => rollbackMut.mutate()}
            >
              Rollback to Selected
            </Button>
            <Button variant="ai" size="sm">Simulate Execution</Button>
          </div>
        </div>

        {showDiff && (
          <Card className="p-5 border-blue-200 bg-blue-50/20">
            <h3 className="text-sm font-bold text-blue-900 mb-2">
              Dynamic Version Diff ({selectedVersion} vs {priorVersionData?.version ?? 'Previous'})
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-900">
                <div className="font-bold mb-1 text-red-700">- Prior Version ({priorVersionData?.version ?? 'Prev'}):</div>
                <pre className="whitespace-pre-wrap overflow-x-auto">{priorCql}</pre>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-900">
                <div className="font-bold mb-1 text-emerald-700">+ Selected Version ({selectedVersion}):</div>
                <pre className="whitespace-pre-wrap overflow-x-auto">{displayedCql}</pre>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                <span>CodeMirror Clinical Quality Language (CQL) Viewer — {selectedVersion}</span>
                <span className="font-mono text-xs text-slate-400">FHIR R4 / CQL 1.5</span>
              </h3>
              <div className="border border-slate-800 rounded-md overflow-hidden text-xs">
                <CodeMirror
                  value={displayedCql}
                  readOnly
                  theme="dark"
                  height="360px"
                />
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Governance & Approval Chain</h3>
              <div className="space-y-3 text-xs text-slate-700">
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Author / Reviewer</span>
                  <span className="font-semibold">{activeVersionData?.actor ?? 'System'}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Revision Timestamp</span>
                  <span className="font-mono font-semibold">{activeVersionData?.timestamp ?? artifact?.updated_at}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Effective Window</span>
                  <span className="font-mono font-semibold">{artifact?.effective_date} to Open</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Version History & Audit Trail</h3>
              <Timeline items={timelineItems} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
