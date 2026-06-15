import { useState } from 'react'

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
 * Minimal FHIR Questionnaire renderer for the pilot DTR flow (string/boolean items).
 * NOTE: the brainstormed design named LHC-Forms (@lhncbc/lforms), but that package does not
 * exist on npm under that name and the real `lforms` v42 is an Angular web component that does
 * not drop cleanly into React 19 / Vite 8. This minimal renderer meets the DTR DoD
 * (render -> complete -> submit -> QuestionnaireResponse) and can be swapped for the LForms
 * web component later. CQL prepopulation is out of scope for the pilot (served, not executed here).
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
    <div data-testid="dtr-form">
      {items.map((it) => (
        <div key={it.linkId} style={{ marginBottom: 12 }}>
          <label style={{ display: 'block' }}>
            {it.text ?? it.linkId}
            {it.type === 'boolean' ? (
              <input
                type="checkbox"
                data-testid={`dtr-item-${it.linkId}`}
                checked={Boolean(answers[it.linkId])}
                onChange={(e) => setAnswer(it.linkId, e.target.checked)}
              />
            ) : (
              <input
                type="text"
                data-testid={`dtr-item-${it.linkId}`}
                value={String(answers[it.linkId] ?? '')}
                onChange={(e) => setAnswer(it.linkId, e.target.value)}
              />
            )}
          </label>
        </div>
      ))}
      <button data-testid="dtr-submit" disabled={submitting} onClick={() => onSubmit(buildQr())}>
        {submitting ? 'Submitting…' : 'Submit documentation'}
      </button>
    </div>
  )
}
