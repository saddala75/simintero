import { render, screen } from '@testing-library/react';
import MarginChart from '../components/MarginChart.js';

const sampleSnapshots = [
  {
    snapshot_id: 's1',
    period_start: '2026-01-01',
    period_end: '2026-03-31',
    revenue_usd: 1000,
    cost_usd: 600,
    margin_usd: 400,
  },
  {
    snapshot_id: 's2',
    period_start: '2026-04-01',
    period_end: '2026-06-30',
    revenue_usd: 1200,
    cost_usd: 700,
    margin_usd: 500,
  },
];

describe('MarginChart', () => {
  it('renders margin rows with correct data-testid when snapshots provided', () => {
    render(<MarginChart snapshots={sampleSnapshots} />);
    expect(screen.getByTestId('margin-row-s1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-row-s2')).toBeInTheDocument();
  });

  it('shows empty-state when snapshots is empty array', () => {
    render(<MarginChart snapshots={[]} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No margin data available.');
  });
});
