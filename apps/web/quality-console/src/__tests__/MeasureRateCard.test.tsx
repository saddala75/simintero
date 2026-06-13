import { render, screen } from '@testing-library/react';
import MeasureRateCard from '../components/MeasureRateCard';

const mockRun = {
  run_id: 'run-1',
  measure_ref: 'https://artifacts.simintero.io/measure/test',
  period_start: '2026-01-01',
  period_end: '2026-12-31',
  status: 'complete',
};

const mockSummary = {
  run_id: 'run-1',
  denominator_count: 100,
  numerator_count: 70,
  exclusion_count: 5,
  gap_count: 30,
  rate: 0.7,
};

describe('MeasureRateCard', () => {
  it('renders measure_ref and period', () => {
    render(<MeasureRateCard run={mockRun} />);
    expect(screen.getByText('https://artifacts.simintero.io/measure/test')).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it('renders rate when summary provided', () => {
    render(<MeasureRateCard run={mockRun} summary={mockSummary} />);
    expect(screen.getByTestId('rate')).toHaveTextContent('70.0%');
  });

  it('does not render rate when summary is undefined', () => {
    render(<MeasureRateCard run={mockRun} />);
    expect(screen.queryByTestId('rate')).not.toBeInTheDocument();
  });
});
