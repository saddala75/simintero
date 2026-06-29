import { useState } from 'react'
import { Card, Badge, Button } from '@sim/design-system'
import type { ClinicalEntity } from '../api/client'

interface Props {
  entities: ClinicalEntity[]
  selectedCitationId?: string
  onSelectCitation?: (citationId: string) => void
  onUpdateStatus: (entityId: string, status: 'accepted' | 'disputed') => void
}

export function ExtractedEntitiesPanel({ entities: initialEntities, selectedCitationId, onSelectCitation, onUpdateStatus }: Props) {
  const [entities, setEntities] = useState<ClinicalEntity[]>(initialEntities)

  const handleAction = (id: string, status: 'accepted' | 'disputed') => {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)))
    onUpdateStatus(id, status)
  }

  const grouped = {
    condition: entities.filter((e) => e.type === 'condition'),
    procedure: entities.filter((e) => e.type === 'procedure'),
    observation: entities.filter((e) => e.type === 'observation'),
  }

  return (
    <Card className="h-full flex flex-col p-5 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="font-bold text-base text-slate-900">Extracted Clinical Entities</h3>
          <p className="text-xs text-slate-500">Structured terminology groundings & provenance</p>
        </div>
        <span className="font-mono text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full font-bold">
          {entities.length} Extracted
        </span>
      </div>

      {(['condition', 'procedure', 'observation'] as const).map((groupType) => {
        const items = grouped[groupType]
        if (items.length === 0) return null

        return (
          <div key={groupType} className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1">
              {groupType}s ({items.length})
            </h4>
            <div className="space-y-3">
              {items.map((item) => {
                const isLinked = item.citationId && item.citationId === selectedCitationId
                return (
                  <div
                    key={item.id}
                    onClick={() => item.citationId && onSelectCitation?.(item.citationId)}
                    className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                      isLinked
                        ? 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/30 shadow-sm'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                          <span>{item.name}</span>
                          {item.citationId && (
                            <span className="font-mono text-[10px] bg-amber-200 text-amber-900 px-1 rounded font-bold">
                              LINKED
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{item.provenance}</div>
                      </div>
                      <Badge variant="rule" label={item.code} />
                    </div>

                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex-1 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${item.confidence * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-bold text-emerald-700">
                        {(item.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-200/60">
                      <span className="text-xs text-slate-600 font-medium">
                        Status:{' '}
                        <span
                          className={`font-bold ${
                            item.status === 'accepted'
                              ? 'text-emerald-700'
                              : item.status === 'disputed'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </span>
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant={item.status === 'accepted' ? 'primary' : 'ghost'}
                          size="sm"
                          onClick={() => handleAction(item.id, 'accepted')}
                        >
                          Accept
                        </Button>
                        <Button
                          variant={item.status === 'disputed' ? 'danger' : 'ghost'}
                          size="sm"
                          onClick={() => handleAction(item.id, 'disputed')}
                        >
                          Dispute
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </Card>
  )
}
