import { render, screen } from '@testing-library/react';
import PlatformSummaryCard from '../components/PlatformSummaryCard';

const sampleSummary = {
  aggregate_id: 'agg-1',
  period_start: '2026-01-01',
  period_end: '2026-12-31',
  tenant_count: 42,
  case_count: 1500,
  gap_count: 200,
  total_cost_usd: 98765.43,
};

describe('PlatformSummaryCard', () => {
  it('renders tenant_count, case_count, gap_count, and total_cost_usd', () => {
    render(<PlatformSummaryCard summary={sampleSummary} />);
    expect(screen.getByTestId('platform-summary-card')).toBeInTheDocument();
    expect(screen.getByText('Tenants: 42')).toBeInTheDocument();
    expect(screen.getByText('Cases: 1500')).toBeInTheDocument();
    expect(screen.getByText('Gaps: 200')).toBeInTheDocument();
    expect(screen.getByText('Total Cost: $98765.43')).toBeInTheDocument();
  });
});
