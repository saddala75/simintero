import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { postCrdHook, getDtrQuestionnaire, postQuestionnaireResponse } from '../api/client'
import { QuestionnaireRenderer } from '../components/QuestionnaireRenderer'
import { Button } from '@sim/design-system'
import type { CrdCard } from '../types'

// ── Presets ──────────────────────────────────────────────────────────────────

const SERVICES = [
  { code: '72148', label: 'Lumbar Spine MRI',            category: 'Imaging',    note: 'Non-contrast' },
  { code: '73721', label: 'Knee MRI',                    category: 'Imaging',    note: 'Right or left' },
  { code: '97001', label: 'Physical Therapy Evaluation', category: 'Therapy',    note: 'Initial eval' },
  { code: '74178', label: 'CT Abdomen & Pelvis',         category: 'Imaging',    note: 'With contrast' },
  { code: '75571', label: 'Coronary CT Angiography',     category: 'Cardiology', note: 'CTA' },
  { code: '95810', label: 'Polysomnography',             category: 'Sleep',      note: '≥ 6 hrs recording' },
  { code: '27447', label: 'Total Knee Arthroplasty',     category: 'Surgery',    note: 'Unilateral' },
  { code: '81450', label: 'Targeted Genomic Sequence',   category: 'Lab',        note: 'Panel ≥ 5 genes' },
]

const PATIENTS = [
  { id: 'p1', name: 'James Morrison',  dob: '1951-03-14', lob: 'Medicare',              planId: 'plan-1' },
  { id: 'p2', name: 'Linda Hartwell',  dob: '1978-07-22', lob: 'Commercial (BlueCross)', planId: 'plan-2' },
  { id: 'p3', name: 'Robert Okafor',   dob: '1965-11-08', lob: 'Medicaid',              planId: 'plan-3' },
]

const HOOKS = [
  { value: 'order-sign',       label: 'order-sign',       desc: 'Provider signs the order — most common PA trigger' },
  { value: 'order-select',     label: 'order-select',     desc: 'Provider selects the order — early coverage discovery' },
  { value: 'appointment-book', label: 'appointment-book', desc: 'Appointment is booked — facility-level check' },
]

// ── Indicator styling ────────────────────────────────────────────────────────

function indicatorStyle(indicator: string) {
  switch (indicator) {
    case 'critical': return 'border-red-200 bg-red-50'
    case 'warning':  return 'border-amber-200 bg-amber-50'
    case 'info':     return 'border-blue-200 bg-blue-50'
    default:         return 'border-slate-200 bg-slate-50'
  }
}

function indicatorBadge(indicator: string) {
  switch (indicator) {
    case 'critical': return 'bg-red-100 text-red-800'
    case 'warning':  return 'bg-amber-100 text-amber-800'
    case 'info':     return 'bg-blue-100 text-blue-800'
    default:         return 'bg-slate-100 text-slate-700'
  }
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Order Entry', 'Coverage Check', 'Documentation']
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = i + 1
        const done = n < step
        const active = n === step
        return (
          <div key={n} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                done   ? 'bg-emerald-500 text-white' :
                active ? 'bg-blue-600 text-white' :
                         'bg-slate-200 text-slate-500'
              }`}>
                {done ? '✓' : n}
              </div>
              <span className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-400'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-4 h-px w-16 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── DTR inline panel ─────────────────────────────────────────────────────────

function DtrPanel({ context, planId }: { context: string; planId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dtr-questionnaire', context, planId],
    queryFn: () => getDtrQuestionnaire(context, planId),
  })
  const mutation = useMutation({ mutationFn: postQuestionnaireResponse })

  return (
    <div className="mt-6 border border-blue-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 bg-blue-600 flex items-center gap-3">
        <span className="text-white font-bold text-sm">Step 3 — Documentation Templates & Rules (DTR)</span>
        <span className="text-blue-200 text-xs">· SMART app · FHIR Questionnaire</span>
      </div>
      <div className="p-6 bg-white">
        {isLoading && <p className="text-sm text-slate-500">Loading questionnaire…</p>}
        {mutation.isSuccess ? (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 font-semibold">
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
          <p className="mt-3 text-xs text-red-600">Submission failed. Please try again.</p>
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function EhrOrderSimPage() {
  const [selectedService, setSelectedService] = useState(SERVICES[0])
  const [selectedPatient, setSelectedPatient] = useState(PATIENTS[0])
  const [hook, setHook] = useState<'order-sign' | 'order-select' | 'appointment-book'>('order-sign')
  const [dtrContext, setDtrContext] = useState<{ context: string; planId: string } | null>(null)

  const crdMutation = useMutation({
    mutationFn: () => postCrdHook({
      hook,
      service_code: selectedService.code,
      patient_id: selectedPatient.id,
      plan_id: selectedPatient.planId,
    }),
    onSuccess: () => setDtrContext(null),
  })

  const cards: CrdCard[] = crdMutation.data ?? []
  const fired = crdMutation.isSuccess || crdMutation.isPending
  const step: 1 | 2 | 3 = dtrContext ? 3 : fired ? 2 : 1

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1200px] mx-auto">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Dev Tool</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded">CDS Hooks · CRD + DTR</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900">EHR Order Simulator</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Simulates a provider ordering a service inside an EHR. The EHR fires a CDS Hook to
            Simintero's Coverage Requirements Discovery (CRD) service, which returns coverage cards.
            The provider then launches DTR to complete documentation before submitting the PA.
          </p>
        </div>

        <StepBar step={step} />

        <div className="grid grid-cols-2 gap-6">

          {/* ── Left: Order Entry ── */}
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">1</div>
                <span className="font-bold text-sm text-slate-800">Order Entry</span>
                <span className="ml-auto text-[10px] font-mono text-slate-400">Simulated EHR</span>
              </div>

              <div className="p-5 space-y-5">
                {/* Patient selector */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Patient</label>
                  <div className="space-y-2">
                    {PATIENTS.map((p) => (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedPatient.id === p.id
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="patient"
                          className="accent-blue-600"
                          checked={selectedPatient.id === p.id}
                          onChange={() => { setSelectedPatient(p); crdMutation.reset() }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                          <div className="text-xs text-slate-500">DOB {p.dob} · {p.lob}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Service selector */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Ordered Service</label>
                  <div className="grid grid-cols-2 gap-2">
                    {SERVICES.map((s) => (
                      <label
                        key={s.code}
                        className={`flex flex-col gap-0.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedService.code === s.code
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="service"
                            className="accent-blue-600 mt-0.5"
                            checked={selectedService.code === s.code}
                            onChange={() => { setSelectedService(s); crdMutation.reset() }}
                          />
                          <div>
                            <div className="font-semibold text-xs text-slate-900 leading-snug">{s.label}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{s.note}</div>
                          </div>
                        </div>
                        <div className="ml-5 flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-slate-500">CPT {s.code}</span>
                          <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{s.category}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Hook type */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">CDS Hook Type</label>
                  <div className="space-y-1.5">
                    {HOOKS.map((h) => (
                      <label
                        key={h.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          hook === h.value
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="hook"
                          className="accent-blue-600 mt-0.5"
                          checked={hook === h.value}
                          onChange={() => { setHook(h.value as typeof hook); crdMutation.reset() }}
                        />
                        <div>
                          <div className="font-mono text-xs font-bold text-slate-800">{h.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{h.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Fire button */}
                <Button
                  data-testid="crd-fire"
                  variant="primary"
                  loading={crdMutation.isPending}
                  onClick={() => { setDtrContext(null); crdMutation.mutate() }}
                  className="w-full justify-center"
                >
                  {crdMutation.isPending ? 'Firing CDS Hook…' : '⚡ Fire CDS Hook'}
                </Button>

                {crdMutation.isError && (
                  <p data-testid="crd-error" className="text-xs text-red-600 text-center">
                    Hook failed — {(crdMutation.error as Error).message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: Coverage Response → DTR (same column, three states) ── */}
          <div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-full">

              {/* State A: DTR launched — show questionnaire */}
              {dtrContext ? (
                <>
                  <div className="px-5 py-3.5 border-b border-slate-100 bg-blue-600 flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-white/20 text-white text-[10px] font-bold flex items-center justify-center">3</div>
                    <span className="font-bold text-sm text-white">Documentation Templates & Rules</span>
                    <button
                      onClick={() => setDtrContext(null)}
                      className="ml-auto text-blue-200 hover:text-white text-xs font-semibold transition-colors"
                    >
                      ← Back to coverage cards
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    <DtrPanel context={dtrContext.context} planId={dtrContext.planId} />
                  </div>
                </>
              ) : (
                <>
                  {/* State B/C: waiting or CDS cards */}
                  <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                      crdMutation.isSuccess ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}>2</div>
                    <span className="font-bold text-sm text-slate-800">Coverage Requirements Discovery</span>
                    <span className="ml-auto text-[10px] font-mono text-slate-400">Payer CRD response</span>
                  </div>

                  <div className="p-5">
                    {!crdMutation.isSuccess && !crdMutation.isPending && (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                          <span className="text-2xl">⚡</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-600">Waiting for CDS Hook</p>
                        <p className="text-xs text-slate-400 mt-1 max-w-xs">
                          Select a patient and service, then fire the hook to see the payer's coverage requirements.
                        </p>
                      </div>
                    )}

                    {crdMutation.isPending && (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                        <p className="text-sm text-slate-500">Querying Coverage Requirements Discovery…</p>
                      </div>
                    )}

                    {crdMutation.isSuccess && (
                      <div className="space-y-3">
                        <div className="text-xs text-slate-500 mb-4 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                          {cards.length} card{cards.length !== 1 ? 's' : ''} returned for{' '}
                          <strong>{selectedPatient.name}</strong> · CPT {selectedService.code}
                        </div>

                        {cards.length === 0 && (
                          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
                            ✓ No coverage requirements — this service does not require prior authorization for {selectedPatient.lob}.
                          </div>
                        )}

                        {cards.map((card, i) => (
                          <div
                            key={i}
                            data-testid="crd-card"
                            className={`rounded-lg border p-4 ${indicatorStyle(card.indicator)}`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <p className="font-bold text-sm text-slate-900 leading-snug">{card.summary}</p>
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${indicatorBadge(card.indicator)}`}>
                                {card.indicator}
                              </span>
                            </div>
                            {card.detail && (
                              <p className="text-xs text-slate-700 leading-relaxed mb-3">{card.detail}</p>
                            )}
                            {card.links?.map((link, j) => (
                              <Button
                                key={j}
                                data-testid="crd-dtr-launch"
                                variant="primary"
                                size="sm"
                                onClick={() => setDtrContext({ context: link.appContext ?? selectedService.code, planId: selectedPatient.planId })}
                                className="mt-1"
                              >
                                📋 {link.label}
                              </Button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
