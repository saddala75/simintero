import { Card, Badge } from '@sim/design-system'
import type { GroundednessMetric } from '../api/client'

interface Props {
  summary: string
  groundedness: GroundednessMetric
  completeness: Array<{ criteria: string; satisfied: boolean; note: string }>
  selectedCitationId?: string | null
  onSelectCitation?: (citationId: string) => void
  className?: string
}

export function AiSummaryPanel({ summary, groundedness, completeness, selectedCitationId, onSelectCitation, className }: Props) {
  return (
    <Card className={className ?? 'h-full flex flex-col p-5 space-y-5 overflow-y-auto'}>
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base text-slate-900">Revital AI Synthesis</h3>
          <p className="text-xs text-slate-500">Grounded evidence evaluation & criteria completeness</p>
        </div>
        <Badge variant="status" status="in_review" label="ADVISORY ONLY" />
      </div>

      <div className="p-4 bg-blue-50/50 border border-blue-200 rounded-lg space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-blue-900">
          <span>AI Groundedness Score</span>
          <span className="font-mono text-sm font-black text-blue-700">
            {(groundedness.score * 100).toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full"
            style={{ width: `${groundedness.score * 100}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-1 text-[11px] text-blue-800 font-mono text-center pt-1 border-t border-blue-200/60">
          <div>
            <span className="font-bold block">{groundedness.citationsCount}</span>
            <span className="text-[10px] text-blue-600">Citations</span>
          </div>
          <div>
            <span className="font-bold block text-amber-700">{groundedness.gapsCount}</span>
            <span className="text-[10px] text-amber-600">Gaps</span>
          </div>
          <div>
            <span className="font-bold block text-red-700">{groundedness.conflictsCount}</span>
            <span className="text-[10px] text-red-600">Conflicts</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Clinical Narrative Synthesis</h4>
          <button
            onClick={() => onSelectCitation?.('span-1')}
            className={`text-[11px] font-medium hover:underline ${selectedCitationId === 'span-1' ? 'text-blue-800 underline' : 'text-blue-600'}`}
          >
            Inspect Citations →
          </button>
        </div>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 leading-relaxed font-sans">
          {summary}
        </div>
      </div>

      <div className="space-y-2 flex-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Coverage Criteria Evaluation</h4>
        <div className="space-y-2.5">
          {completeness.map((item, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-md border text-xs space-y-1 ${
                item.satisfied ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900' : 'bg-amber-50/50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span>{item.criteria}</span>
                <span>{item.satisfied ? '✓ SATISFIED' : '⚠ PENDING'}</span>
              </div>
              <p className="text-[11px] opacity-85 font-mono">{item.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 bg-slate-900 text-slate-200 rounded-md text-[11px] border border-slate-800 space-y-1 mt-auto">
        <div className="font-bold text-amber-400 flex items-center gap-1">
          <span>⚠️ Mandatory Clinical Advisory Notice</span>
        </div>
        <p className="text-slate-400 leading-tight">
          AI generated outputs are strictly advisory decision assistance tools. Human clinical reviewer signature and explicit sign-off are legally required for all final prior authorization determinations under CMS-0057-F guidelines.
        </p>
      </div>
    </Card>
  )
}
