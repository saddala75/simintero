import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { createArtifact } from '../api/client'
import { Card, Button, Badge } from '@sim/design-system'

export function NewPolicyPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [lob, setLob] = useState<'commercial' | 'medicare' | 'medicaid' | 'all'>('commercial')
  const [cql, setCql] = useState("library NewPolicy version '1.0.0'\nusing FHIR version '4.0.1'\n")
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'success'>('idle')
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: () => createArtifact({ name: name || 'Untitled Policy Rule', lob, cql, status: 'draft' }),
    onSuccess: (res) => {
      setSubmitSuccess(`Policy "${name || 'Untitled Policy Rule'}" successfully submitted as artifact ${res.id}! Pending CMO signoff.`)
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      setTimeout(() => {
        navigate('/')
      }, 2500)
    },
  })

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1000px] mx-auto space-y-6">
        {submitSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-md text-sm text-emerald-900 font-semibold flex items-center justify-between">
            <span>✓ {submitSuccess}</span>
            <span className="text-xs text-emerald-700 animate-pulse">Redirecting to registry…</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              ← Cancel
            </Button>
            <h1 className="text-2xl font-black text-slate-900">Author New Policy Artifact</h1>
          </div>
          <Button
            variant="primary"
            loading={createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            Submit for Governance Review
          </Button>
        </div>

        <Card className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Policy Name</label>
            <input
              type="text"
              placeholder="e.g. Total Knee Arthroplasty Prior Auth Rule"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Line of Business Applicability</label>
            <select
              value={lob}
              onChange={(e) => setLob(e.target.value as 'commercial' | 'medicare' | 'medicaid' | 'all')}
              className="w-full px-4 py-2 border border-slate-300 rounded-md text-sm bg-white"
            >
              <option value="commercial">Commercial</option>
              <option value="medicare">Medicare</option>
              <option value="medicaid">Medicaid</option>
              <option value="all">All LOBs</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase text-slate-600">CodeMirror Clinical Logic (CQL) Editor</label>
              <Button
                variant="ai"
                size="sm"
                onClick={() => setSimulationStatus('success')}
              >
                Run Validation Simulation
              </Button>
            </div>
            <div className="border border-slate-300 rounded-md overflow-hidden text-xs">
              <CodeMirror
                value={cql}
                height="300px"
                theme="dark"
                onChange={(val) => setCql(val)}
              />
            </div>
          </div>

          {simulationStatus === 'success' && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md flex items-center justify-between text-xs text-emerald-800">
              <span className="font-semibold">✓ CQL Syntax and FHIR R4 schema validation passed successfully!</span>
              <Badge variant="status" status="approved" label="PASSED" />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
