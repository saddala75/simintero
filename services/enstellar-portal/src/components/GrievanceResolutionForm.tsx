import { useState, useEffect, useImperativeHandle } from 'react'
import type { RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { resolveGrievance } from '../api/client'
import type { GrievanceResolutionPayload } from '../types'

export type GrievanceFormReadiness = {
  resolutionWritten: boolean
}

interface Props {
  grievanceId: string
  onComplete: () => void
  onReadinessChange: (s: GrievanceFormReadiness) => void
  submitRef: RefObject<{ submit: () => void } | null>
}

export function GrievanceResolutionForm({ grievanceId, onComplete, onReadinessChange, submitRef }: Props) {
  const [resolution, setResolution] = useState('')

  const mut = useMutation({
    mutationFn: () => {
      const payload: GrievanceResolutionPayload = { resolution: resolution.trim() }
      return resolveGrievance(grievanceId, payload)
    },
    onSuccess: () => {
      onComplete()
    },
  })

  useImperativeHandle(submitRef, () => ({
    submit: () => {
      if (!mut.isPending) mut.mutate()
    },
  }), [mut])

  useEffect(() => {
    onReadinessChange({ resolutionWritten: resolution.trim().length > 0 })
  }, [resolution, onReadinessChange])

  return (
    <div className="en-resolution-form">
      <label className="en-field-label">Resolution</label>
      <textarea
        className="en-textarea"
        data-testid="grievance-resolution-textarea"
        value={resolution}
        onChange={e => setResolution(e.target.value)}
        rows={4}
        placeholder="Describe how this grievance was resolved…"
      />
      {mut.isError && (
        <p className="en-error-text">Submission failed. Please try again.</p>
      )}
    </div>
  )
}
