import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getWorklist, type WorklistItem } from '../api/client'

export function CaseSelectorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routePrefix = location.pathname.startsWith('/revital') ? '/revital' : '/ai-workbench'
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['revital-worklist'],
    queryFn: getWorklist,
    staleTime: 30_000,
  })

  return (
    <div style={{ maxWidth: 760, margin: '48px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>AI Review · Revital</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Select a case from the active worklist to open the AI review workbench.
      </p>

      {isLoading && <p>Loading cases…</p>}
      {isError && (
        <p style={{ color: '#c00' }}>
          Could not load worklist — is the BFF running on port 8001?
        </p>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <p style={{ color: '#888' }}>No active cases found.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item: WorklistItem) => (
          <button
            key={item.case_id}
            onClick={() => navigate(`/cases/${item.case_id}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              border: '1px solid #dde',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.member_name}</div>
              <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>
                {item.service_description}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#888', textTransform: 'uppercase' }}>
                {item.lob}
              </span>
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 12,
                background: item.urgency === 'expedited' ? '#fff3e0' : '#e8f5e9',
                color: item.urgency === 'expedited' ? '#e65100' : '#2e7d32',
              }}>
                {item.urgency}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
