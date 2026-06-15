import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getWorklist } from '../api/client'
import { SlaCell } from './SlaCell'

interface Props {
  queueId: string
  page?: number
}

export function WorklistTable({ queueId, page = 1 }: Props) {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['worklist', queueId, page],
    queryFn: () => getWorklist(queueId, page),
  })

  if (isLoading) {
    return <p>Loading worklist…</p>
  }
  if (isError) {
    return <p role="alert">Error: {(error as Error).message}</p>
  }
  if (!data || data.items.length === 0) {
    return <p>No cases in queue.</p>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Member</th>
          <th>Service</th>
          <th>LOB</th>
          <th>Status</th>
          <th>Urgency</th>
          <th>SLA</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((item) => (
          <tr
            key={item.case_id}
            onClick={() => navigate(`/cases/${item.case_id}`)}
            style={{ cursor: 'pointer' }}
            data-testid={`worklist-row-${item.case_id}`}
          >
            <td>{item.member_name}</td>
            <td>{item.service_description}</td>
            <td>{item.lob}</td>
            <td>{item.status}</td>
            <td>{item.urgency}</td>
            <td>
              <SlaCell sla={item.sla} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
