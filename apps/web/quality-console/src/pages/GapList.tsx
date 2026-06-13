import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import GapTable from '../components/GapTable';

interface Gap {
  gap_id: string;
  member_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
  gap_type: string;
  status: string;
  detected_at: string;
  task_id?: string | null;
}

async function fetchGaps(status: string): Promise<Gap[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const res = await fetch(`/api/quality/gaps?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch gaps');
  const data = await res.json() as { gaps: Gap[] };
  return data.gaps;
}

export default function GapList() {
  const [statusFilter, setStatusFilter] = useState('open');
  const { data: gaps = [], isError } = useQuery({
    queryKey: ['gaps', statusFilter],
    queryFn: () => fetchGaps(statusFilter),
  });

  if (isError) return <p role="alert">Failed to load gaps.</p>;

  return (
    <div>
      <h1>Quality Gaps</h1>
      <GapTable gaps={gaps} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} />
    </div>
  );
}
