import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getDtrQuestionnaire, postQuestionnaireResponse } from '../api/client'
import { QuestionnaireRenderer } from '../components/QuestionnaireRenderer'

export function DtrFormPage() {
  const [params] = useSearchParams()
  const context = params.get('context') ?? 'svc-1'
  const plan = params.get('plan') ?? 'plan-1'

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dtr-questionnaire', context, plan],
    queryFn: () => getDtrQuestionnaire(context, plan),
  })

  const mutation = useMutation({ mutationFn: postQuestionnaireResponse })

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <h1>DTR Documentation</h1>
      <p>Complete the payer's documentation requirements for service {context}.</p>
      {isLoading && <p>Loading questionnaire…</p>}
      {isError && <p data-testid="dtr-error">Failed to load questionnaire.</p>}
      {mutation.isSuccess ? (
        <p data-testid="dtr-submitted">
          Documentation submitted — prior authorization request created.
        </p>
      ) : (
        data && (
          <QuestionnaireRenderer
            questionnaire={data}
            submitting={mutation.isPending}
            onSubmit={(qr) => mutation.mutate(qr)}
          />
        )
      )}
      {mutation.isError && <p data-testid="dtr-submit-error">Submit failed.</p>}
    </div>
  )
}
