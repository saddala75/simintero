import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CaseTimeline from '../pages/CaseTimeline.js';

vi.mock('../api/supportConsoleClient.js', () => ({
  supportConsoleClient: {
    startImpersonation: vi.fn(),
    endImpersonation: vi.fn().mockResolvedValue(undefined),
    getCaseTimeline: vi.fn().mockResolvedValue([
      {
        event_id: 'evt_001',
        event_type: 'case_created',
        occurred_at: '2026-06-11T10:00:00Z',
        payload: { status: 'open' },
      },
      {
        event_id: 'evt_002',
        event_type: 'case_updated',
        occurred_at: '2026-06-11T11:00:00Z',
        payload: { status: 'in_review' },
      },
    ]),
    requestDiagnosticBundle: vi.fn().mockResolvedValue({ operation_id: 'op_001' }),
  },
}));

describe('CaseTimeline', () => {
  it('renders events in sequence with event_type and occurred_at', async () => {
    render(<CaseTimeline caseId="case_001" sessionToken="tok_123" />);

    await waitFor(() => {
      expect(screen.getByText('case_created')).toBeInTheDocument();
      expect(screen.getByText('case_updated')).toBeInTheDocument();
      expect(screen.getByText('2026-06-11T10:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('2026-06-11T11:00:00Z')).toBeInTheDocument();
    });
  });

  it('clicking an event expands the payload', async () => {
    render(<CaseTimeline caseId="case_001" sessionToken="tok_123" />);

    await waitFor(() => {
      expect(screen.getByText('case_created')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('case_created'));

    expect(screen.getByText(/"status"/)).toBeInTheDocument();
  });
});
