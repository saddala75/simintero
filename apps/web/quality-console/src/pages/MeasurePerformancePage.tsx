import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMeasures } from '../api/client'
import { Card, Badge, Button } from '@sim/design-system'

export function MeasurePerformancePage() {
  const navigate = useNavigate()
  const { data: measures = [], isLoading } = useQuery({
    queryKey: ['measures'],
    queryFn: getMeasures,
  })

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Qualitron Quality Console</h1>
            <p className="text-sm text-slate-500 mt-1">HEDIS, CMS Stars, QRS & Medicaid Measure Performance</p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/qualitron/library')}>
              Manage Measures
            </Button>
            <Button variant="ghost" onClick={() => navigate('/qualitron/gaps')}>
              View All Care Gaps
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading quality measure performance…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {measures.map((m) => (
              <Card
                key={m.id}
                className="p-6 cursor-pointer hover:shadow-lg transition-all border-slate-200"
                onClick={() => navigate(`/qualitron/gaps?measure=${m.code}&program=${m.program}`)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="font-mono text-xs font-bold text-slate-500 block">{m.code} · {m.program}</span>
                    <h3 className="font-bold text-slate-900 text-lg mt-0.5">{m.name}</h3>
                  </div>
                  <Badge variant="status" status={m.score >= m.target ? 'approved' : 'pending'} label={`${m.score}%`} />
                </div>

                <div className="grid grid-cols-3 gap-4 py-3 bg-slate-50 rounded-lg p-3 border border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-500 block">Current Score</span>
                    <span className="font-bold font-mono text-slate-900 text-base">{m.score}%</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Target Threshold</span>
                    <span className="font-bold font-mono text-slate-900 text-base">{m.target}%</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Performance Trend</span>
                    <span className={`font-bold font-mono text-sm uppercase ${m.trend === 'up' ? 'text-emerald-700' : m.trend === 'down' ? 'text-red-700' : 'text-slate-700'}`}>
                      {m.trend === 'up' ? '▲ Improving' : m.trend === 'down' ? '▼ Declining' : '► Stable'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-mono">
                  <span>Population: {m.population}</span>
                  <span className="font-bold text-slate-800">{m.numerator.toLocaleString()} / {m.denominator.toLocaleString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
