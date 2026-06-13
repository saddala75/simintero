interface MeasureRun {
  run_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
  status: string;
}

interface MeasureSummary {
  run_id: string;
  denominator_count: number;
  numerator_count: number;
  exclusion_count: number;
  gap_count: number;
  rate: number;
}

interface MeasureRateCardProps {
  run: MeasureRun;
  summary?: MeasureSummary;
}

export default function MeasureRateCard({ run, summary }: MeasureRateCardProps) {
  return (
    <div data-testid="measure-rate-card">
      <h3>{run.measure_ref}</h3>
      <p>Period: {run.period_start} — {run.period_end}</p>
      <p>Status: {run.status}</p>
      {summary && (
        <>
          {/* HUMAN_REVIEW: Rate display — internal use only until quality specialist review */}
          <p data-testid="rate">Rate: {(summary.rate * 100).toFixed(1)}%</p>
          <p>Denominator: {summary.denominator_count}</p>
          <p>Numerator: {summary.numerator_count}</p>
          <p>Exclusions: {summary.exclusion_count}</p>
          <p>Open Gaps: {summary.gap_count}</p>
          <small>⚠ Rate display — internal use only until quality specialist review</small>
        </>
      )}
    </div>
  );
}
