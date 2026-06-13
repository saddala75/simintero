import { useQuery } from '@tanstack/react-query';

interface DlqMessage {
  message_id: string;
  topic: string;
  correlation_id: string;
  error: string;
  failed_at: string;
  payload_hash: string;
}

interface DlqInspectorProps {
  topic?: string;
}

async function fetchDlqMessages(topic?: string): Promise<DlqMessage[]> {
  const url = topic ? `/api/dlq?topic=${encodeURIComponent(topic)}` : '/api/dlq';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DLQ fetch error ${res.status}`);
  return res.json() as Promise<DlqMessage[]>;
}

export function DlqInspector({ topic }: DlqInspectorProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dlq', topic],
    queryFn: () => fetchDlqMessages(topic),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p>Loading DLQ messages…</p>;
  if (error) return <p role="alert">Error loading DLQ: {(error as Error).message}</p>;
  if (!data?.length) return <p>No messages in DLQ{topic ? ` for topic ${topic}` : ''}.</p>;

  return (
    <div className="dlq-inspector">
      <h3>DLQ Messages ({data.length})</h3>
      <table className="dlq-inspector__table">
        <thead>
          <tr>
            <th>Correlation ID</th>
            <th>Topic</th>
            <th>Error</th>
            <th>Failed At</th>
          </tr>
        </thead>
        <tbody>
          {data.map(msg => (
            <tr key={msg.message_id}>
              <td>{msg.correlation_id}</td>
              <td>{msg.topic}</td>
              <td>{msg.error}</td>
              <td>{new Date(msg.failed_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
