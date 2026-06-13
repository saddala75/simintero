import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
        clock: { state: 'breached', deadline: '2026-01-15T00:00:00Z' },
      },
      {
        case_id: 'case_002',
        urgency: 'standard',
        state: 'RECEIVED',
        member_ref: 'Patient/pat-002',
        lob: 'MA',
        clock: { state: 'running', deadline: '2026-02-01T00:00:00Z' },
      },
    ],
    loading: false,
    error: null,
    loadMore: vi.fn(),
  }),
}));

describe('Worklist', () => {
  it('renders case cards for both cases', () => {
    render(<Worklist />);
    expect(screen.getByText(/case_001/i)).toBeInTheDocument();
    expect(screen.getByText(/case_002/i)).toBeInTheDocument();
  });

  it('shows "Breached" badge for case_001 (clock.state === breached)', () => {
    render(<Worklist />);
    const card001 = screen.getByText(/case_001/i).closest('[data-case-id]') as HTMLElement;
    expect(within(card001).getByText('Breached')).toBeInTheDocument();
  });

  it('case_001 (expedited) appears before case_002 (standard) in the list', () => {
    render(<Worklist />);
    const cards = screen.getAllByRole('listitem');
    const card001Index = cards.findIndex((el) => el.textContent?.includes('case_001'));
    const card002Index = cards.findIndex((el) => el.textContent?.includes('case_002'));
    expect(card001Index).toBeLessThan(card002Index);
  });
});
