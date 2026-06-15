import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { postCrdHook } from '../api/client'
import type { CrdCard } from '../types'

type Hook = 'order-select' | 'order-sign' | 'appointment-book'

export function EhrOrderSimPage() {
  const navigate = useNavigate()
  const [hook, setHook] = useState<Hook>('order-sign')
  const [serviceCode, setServiceCode] = useState('72148')
  const [patientId, setPatientId] = useState('p1')
  const [planId, setPlanId] = useState('plan-1')

  const mutation = useMutation({
    mutationFn: () =>
      postCrdHook({ hook, service_code: serviceCode, patient_id: patientId, plan_id: planId }),
  })

  const cards: CrdCard[] = mutation.data ?? []

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <h1>EHR Order Simulator (CRD)</h1>
      <p>Simulate an EHR firing a CDS Hook to discover coverage requirements.</p>

      <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <label>
          Hook
          <select data-testid="crd-hook" value={hook} onChange={(e) => setHook(e.target.value as Hook)}>
            <option value="order-select">order-select</option>
            <option value="order-sign">order-sign</option>
            <option value="appointment-book">appointment-book</option>
          </select>
        </label>
        <label>
          Service code
          <input data-testid="crd-service" value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} />
        </label>
        <label>
          Patient ID
          <input data-testid="crd-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
        </label>
        <label>
          Plan ID
          <input data-testid="crd-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} />
        </label>
        <button data-testid="crd-fire" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Firing…' : 'Fire hook'}
        </button>
      </div>

      {mutation.isError && (
        <p data-testid="crd-error">Error: {(mutation.error as Error).message}</p>
      )}

      <div style={{ marginTop: 24 }}>
        {cards.map((card, i) => (
          <div
            key={i}
            data-testid="crd-card"
            style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginBottom: 12 }}
          >
            <strong>{card.summary}</strong> <em>({card.indicator})</em>
            {card.detail && <p>{card.detail}</p>}
            {card.links?.map((link, j) => (
              <button
                key={j}
                data-testid="crd-dtr-launch"
                onClick={() =>
                  navigate(
                    `/dtr?context=${encodeURIComponent(link.appContext ?? serviceCode)}` +
                      `&plan=${encodeURIComponent(planId)}`,
                  )
                }
              >
                {link.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
