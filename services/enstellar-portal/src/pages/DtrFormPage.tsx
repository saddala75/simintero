import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getDtrQuestionnaire, postQuestionnaireResponse } from '../api/client'
import { QuestionnaireRenderer } from '../components/QuestionnaireRenderer'

export function DtrFormPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const context = params.get('context') ?? 'svc-1'
  const plan = params.get('plan') ?? 'plan-1'

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dtr-questionnaire', context, plan],
    queryFn: () => getDtrQuestionnaire(context, plan),
  })

  const mutation = useMutation({ mutationFn: postQuestionnaireResponse })

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[640px] mx-auto space-y-6">

        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/ehr-sim')}
            className="text-xs text-slate-500 hover:text-slate-800 font-semibold transition-colors"
          >
            ← Back to EHR Simulator
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded">DTR · Documentation Templates & Rules</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900">Complete Documentation Requirements</h1>
          <p className="text-sm text-slate-500 mt-1">
            Service: <span className="font-mono font-semibold">{context}</span> · Plan: <span className="font-mono font-semibold">{plan}</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          {isLoading && (
            <div className="py-8 text-center text-slate-500 text-sm">Loading questionnaire…</div>
          )}
          {isError && (
            <div data-testid="dtr-error" className="py-4 text-center text-red-600 text-sm">
              Failed to load questionnaire. Please try again.
            </div>
          )}
          {mutation.isSuccess ? (
            <div data-testid="dtr-submitted" className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 font-semibold">
              ✓ Documentation submitted — prior authorization request created and queued for clinical review.
            </div>
          ) : (
            data && (
              <QuestionnaireRenderer
                questionnaire={data}
                submitting={mutation.isPending}
                onSubmit={(qr) => mutation.mutate(qr)}
              />
            )
          )}
          {mutation.isError && (
            <p data-testid="dtr-submit-error" className="mt-3 text-xs text-red-600 text-center">
              Submission failed. Please try again.
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
