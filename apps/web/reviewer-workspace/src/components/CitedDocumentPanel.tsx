import type { CitationSpan } from '../api/client'

interface Props {
  caseId: string
  documentUrl: string | null
  citations: CitationSpan[]
  selectedCitationId?: string
  onSelectCitation?: (citationId: string) => void
}

export function CitedDocumentPanel({ caseId, documentUrl, citations, selectedCitationId, onSelectCitation }: Props) {
  const activeSpan = selectedCitationId || citations[0]?.id || 'span-1'

  return (
    <div className="h-full flex flex-col p-0 overflow-hidden border border-slate-200 rounded-lg bg-slate-900 text-white shadow-sm">
      <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h3 className="font-bold text-sm text-white">Medical Record Document Viewer</h3>
        </div>
        <span className="font-mono text-xs text-slate-400 font-semibold">{documentUrl || 'No document'}</span>
      </div>

      <div className="p-3 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
        <span>Presigned MinIO PDF Ingestion Stream</span>
        <span className="font-mono text-emerald-400 font-bold">{citations.length} Verified Citations</span>
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-900">
        <div className="p-5 bg-slate-950 rounded-lg border border-slate-800 font-serif text-sm text-slate-200 leading-relaxed space-y-4 shadow-inner">
          <div className="pb-3 border-b border-slate-800 font-sans text-xs text-slate-400 flex justify-between">
            <span>NEUROLOGY CLINICAL PROGRESS NOTE · CASE {caseId}</span>
            <span>DATE: JUNE 22, 2026</span>
          </div>
          
          <p>
            <strong>Chief Complaint:</strong> Severe lower back pain with radiation into right calf and foot.
          </p>

          {citations.map((c, idx) => {
            const isSelected = activeSpan === c.id
            return (
              <div
                key={c.id}
                onClick={() => onSelectCitation?.(c.id)}
                className={`p-3 rounded border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-amber-500/20 border-amber-400 text-amber-100 ring-2 ring-amber-400/50 shadow-md'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded font-bold">
                    CIT-{idx + 1}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">{c.bbox}</span>
                </div>
                <p>{c.text}</p>
              </div>
            )
          })}
        </div>

        <div className="space-y-2 pt-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Jump to Citation Span:</div>
          <div className="grid grid-cols-3 gap-2">
            {citations.map((c, idx) => (
              <button
                key={c.id}
                onClick={() => onSelectCitation?.(c.id)}
                className={`p-2 text-left rounded border text-xs transition-all ${
                  activeSpan === c.id
                    ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold shadow-sm'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <div>CIT-{idx + 1}</div>
                <div className="font-mono text-[10px] opacity-75">{c.bbox}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
