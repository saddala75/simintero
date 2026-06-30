import { useState } from 'react'
import { Button } from '@sim/design-system'

interface QItem {
  linkId: string
  text?: string
  type: string
}

interface Questionnaire {
  url?: string
  item?: QItem[]
}

/**
 * ponytail: minimal FHIR Questionnaire renderer for the pilot DTR flow.
 * Supports string and boolean items only. Swap for LForms web component post-pilot.
 */
export function QuestionnaireRenderer({
  questionnaire,
  onSubmit,
  submitting,
}: {
  questionnaire: Questionnaire
  onSubmit: (qr: unknown) => void
  submitting?: boolean
}) {
  const items = questionnaire.item ?? []
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({})

  const setAnswer = (linkId: string, value: string | boolean) =>
    setAnswers((a) => ({ ...a, [linkId]: value }))

  const buildQr = () => ({
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    questionnaire: questionnaire.url,
    subject: { reference: 'Patient/p1' },
    item: items.map((it) => ({
      linkId: it.linkId,
      answer: [
        it.type === 'boolean'
          ? { valueBoolean: Boolean(answers[it.linkId]) }
          : { valueString: String(answers[it.linkId] ?? '') },
      ],
    })),
  })

  return (
    <div data-testid="dtr-form" className="space-y-4">
      {items.map((it) => (
        <div key={it.linkId}>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
            {it.text ?? it.linkId}
          </label>
          {it.type === 'boolean' ? (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                data-testid={`dtr-item-${it.linkId}`}
                checked={Boolean(answers[it.linkId])}
                onChange={(e) => setAnswer(it.linkId, e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded"
              />
              <span className="text-sm text-slate-700">Yes</span>
            </label>
          ) : (
            <input
              type="text"
              data-testid={`dtr-item-${it.linkId}`}
              value={String(answers[it.linkId] ?? '')}
              onChange={(e) => setAnswer(it.linkId, e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          )}
        </div>
      ))}

      <Button
        data-testid="dtr-submit"
        variant="primary"
        loading={submitting}
        onClick={() => onSubmit(buildQr())}
        className="mt-2 w-full justify-center"
      >
        {submitting ? 'Submitting…' : 'Submit Documentation'}
      </Button>
    </div>
  )
}
