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

  const { data: workbenchCase, isLoading } = useQuery({
    queryKey: ['workbench-case', caseId],
    queryFn: () => getWorkbenchCase(caseId),
  })

  const determinationMut = useMutation({
    mutationFn: (decision: 'approved' | 'denied') => submitDetermination(caseId, decision),
    onSuccess: (res) => {
      setDeterminationResult(`Prior Authorization Determination successfully recorded as ${res.decision.toUpperCase()}! Compliance audit logged.`)
      queryClient.invalidateQueries({ queryKey: ['workbench-case', caseId] })
    },
  })

  if (isLoading || !workbenchCase) {
    return <div className="p-8 text-center text-slate-500">Loading AI review workbench telemetry…</div>
  }

  return (
    <div className="h-screen flex flex-col bg-[#F7F9FB] overflow-hidden">
      <header className="h-14 bg-slate-950 text-white px-6 flex items-center justify-between z-20 border-b border-slate-800 shadow-md shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate('/')}
            className="text-xs font-semibold text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
          >
            ← Back to Portal Worklist
          </button>
          <div className="h-4 w-px bg-slate-800" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-bold text-base text-white">{workbenchCase.caseId} · {workbenchCase.serviceRequested}</h1>
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
            onClick={() => determinationMut.mutate('approved')}
          >
            ✦ Accept AI Advisory Determination
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={determinationMut.isPending}
            onClick={() => determinationMut.mutate('denied')}
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
            onUpdateStatus={(entId, status) => updateEntityStatus(caseId, entId, status)}
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
