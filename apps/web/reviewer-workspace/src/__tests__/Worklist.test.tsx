import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Worklist } from '../pages/Worklist.js';

vi.mock('../hooks/useWorklist.js', () => ({
  useWorklist: vi.fn().mockReturnValue({
    cases: [
      {
        case_id: 'case_001',
        urgency: 'expedited',
        state: 'IN_REVIEW',
        member_ref: 'Patient/pat-001',
        lob: 'MA',
        clock: { state: 'crit', deadline: '04:30' },
      },
      {
        case_id: 'case_002',
        urgency: 'standard',
        state: 'RECEIVED',
        member_ref: 'Patient/pat-002',
        lob: 'MA',
        clock: { state: 'ok', deadline: '72:00' },
      },
    ],
    loading: false,
    error: null,
    loadMore: vi.fn(),
  }),
}));

const noop = vi.fn();

describe('Worklist', () => {
  it('renders rows for both cases', () => {
    render(<Worklist onSelectCase={noop} onMdDetermination={noop} />);
    // IDs display as PA-CASE_001 (last 8 chars uppercased)
    expect(screen.getByText(/CASE_001/i)).toBeInTheDocument();
    expect(screen.getByText(/CASE_002/i)).toBeInTheDocument();
  });

  it('shows "In Review" badge for case_001', () => {
    render(<Worklist onSelectCase={noop} onMdDetermination={noop} />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('expedited case (case_001) appears before standard (case_002)', () => {
    render(<Worklist onSelectCase={noop} onMdDetermination={noop} />);
    const rows = screen.getAllByRole('row').slice(1); // skip header
    const idx001 = rows.findIndex(r => r.textContent?.includes('CASE_001'));
    const idx002 = rows.findIndex(r => r.textContent?.includes('CASE_002'));
    expect(idx001).toBeLessThan(idx002);
  });
});
