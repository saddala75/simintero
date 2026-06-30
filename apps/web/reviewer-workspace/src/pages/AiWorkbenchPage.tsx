import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getWorkbenchCase, updateEntityStatus, submitDetermination } from '../api/client'
import { CitedDocumentPanel } from '../components/CitedDocumentPanel'
import { ExtractedEntitiesPanel } from '../components/ExtractedEntitiesPanel'
import { AiSummaryPanel } from '../components/AiSummaryPanel'
import { Button, Badge } from '@sim/design-system'

export function AiWorkbenchPage() {
  const { caseId = 'PA-2026-88492' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedCitationId, setSelectedCitationId] = useState<string>('span-1')
  const [determinationResult, setDeterminationResult] = useState<string | null>(null)
  const [entityError, setEntityError] = useState<string | null>(null)

  const { data: workbenchCase, isLoading, isError } = useQuery({
    queryKey: ['workbench-case', caseId],
    queryFn: () => getWorkbenchCase(caseId),
    retry: 1,
  })

  const entityStatusMut = useMutation({
    mutationFn: ({ entityId, status }: { entityId: string; status: 'accepted' | 'disputed' }) =>
      updateEntityStatus(caseId, entityId, status),
    onSuccess: () => {
      setEntityError(null)
      queryClient.invalidateQueries({ queryKey: ['workbench-case', caseId] })
    },
    onError: (err) => {
      setEntityError(`Failed to update clinical entity status: ${err instanceof Error ? err.message : 'Server error'}`)
      queryClient.invalidateQueries({ queryKey: ['workbench-case', caseId] })
    },
  })

  const determinationMut = useMutation({
    mutationFn: (decision: 'accept' | 'adverse') => submitDetermination(caseId, decision),
    onSuccess: (res) => {
      setDeterminationResult(`Prior Authorization Determination successfully recorded as ${res.status.toUpperCase()}! Compliance audit logged.`)
      queryClient.invalidateQueries({ queryKey: ['workbench-case', caseId] })
    },
  })

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading AI review workbench telemetry…</div>
  }

  if (isError || !workbenchCase) {
    return (
      <div className="p-12 text-center max-w-lg mx-auto space-y-4">
        <h2 className="text-xl font-bold text-slate-800">No Case in Context</h2>
        <p className="text-sm text-slate-600">
          Please select an active case from the worklist to open the Revital AI review workbench.
        </p>
        <button
          onClick={() => navigate('/revital')}
          className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium text-sm hover:bg-blue-700"
        >
          Select Case from Worklist
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F9FB] overflow-hidden">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/worklist')}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-medium bg-slate-800 px-2.5 py-1.5 rounded border border-slate-700 transition-colors"
          >
            ← Back to Portal Worklist
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-bold text-lg text-white font-mono">{workbenchCase.caseId} · {workbenchCase.serviceRequested}</h1>
              <Badge variant="status" status="in_review" label="IN CLINICAL REVIEW" />
            </div>
            <p className="text-[11px] text-slate-400 font-mono">Member: {workbenchCase.memberName} (DOB: {workbenchCase.memberDob})</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ai"
            size="sm"
            loading={determinationMut.isPending}
            onClick={() => determinationMut.mutate('accept')}
          >
            ✦ Accept AI Advisory Determination
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={determinationMut.isPending}
            onClick={() => determinationMut.mutate('adverse')}
          >
            Adverse Determination Signoff
          </Button>
        </div>
      </header>

      {determinationResult && (
        <div className="bg-emerald-600 text-white px-6 py-2.5 text-xs font-bold flex items-center justify-between z-20 border-b border-emerald-700 shadow-sm shrink-0">
          <span>✓ {determinationResult}</span>
          <button onClick={() => setDeterminationResult(null)} className="hover:opacity-80">✕ Dismiss</button>
        </div>
      )}

      {entityError && (
        <div className="bg-red-600 text-white px-6 py-2.5 text-xs font-bold flex items-center justify-between z-20 border-b border-red-700 shadow-sm shrink-0">
          <span>✕ {entityError}</span>
          <button onClick={() => setEntityError(null)} className="hover:opacity-80">✕ Dismiss</button>
        </div>
      )}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden">
        <div className="lg:col-span-4 h-full overflow-hidden">
          <CitedDocumentPanel
            caseId={caseId}
            documentUrl={workbenchCase.documentUrl}
            citations={workbenchCase.citations}
            selectedCitationId={selectedCitationId}
            onSelectCitation={setSelectedCitationId}
          />
        </div>
        <div className="lg:col-span-4 h-full overflow-hidden">
          <ExtractedEntitiesPanel
            entities={workbenchCase.entities}
            selectedCitationId={selectedCitationId}
            onSelectCitation={setSelectedCitationId}
            onUpdateStatus={(entityId, status) => entityStatusMut.mutate({ entityId, status })}
          />
        </div>
        <div className="lg:col-span-4 h-full overflow-hidden">
          <AiSummaryPanel
            summary={workbenchCase.summary}
            groundedness={workbenchCase.groundedness}
            completeness={workbenchCase.completeness}
            onSelectCitation={setSelectedCitationId}
          />
        </div>
      </main>
    </div>
  )
}
