import { useQuery } from '@tanstack/react-query';
import MeasureRateCard from '../components/MeasureRateCard';

interface MeasureRun {
  run_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
  status: string;
}

async function fetchRuns(): Promise<MeasureRun[]> {
  const res = await fetch('/api/quality/measures');
  if (!res.ok) throw new Error('Failed to fetch measure runs');
  const data = await res.json() as { runs: MeasureRun[] };
  return data.runs;
}

export default function MeasureDashboard() {
  const { data: runs, isLoading, isError } = useQuery({ queryKey: ['measures'], queryFn: fetchRuns });

  if (isLoading) return <p>Loading...</p>;
  if (isError) return <p role="alert">Failed to load measure runs.</p>;

  return (
    <div>
      <h1>Measure Dashboard</h1>
      {runs?.map((run) => (
        <MeasureRateCard key={run.run_id} run={run} />
      ))}
    </div>
  );
}
