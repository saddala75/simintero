import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiagnosticBundleExport from '../pages/DiagnosticBundleExport.js';
import { supportConsoleClient } from '../api/supportConsoleClient.js';

vi.mock('../api/supportConsoleClient.js', () => ({
  supportConsoleClient: {
    startImpersonation: vi.fn(),
    endImpersonation: vi.fn().mockResolvedValue(undefined),
    getCaseTimeline: vi.fn().mockResolvedValue([]),
    requestDiagnosticBundle: vi.fn().mockResolvedValue({ operation_id: 'op_001' }),
  },
}));

describe('DiagnosticBundleExport', () => {
  it('calls requestDiagnosticBundle when "Request Export" button is clicked', async () => {
    render(<DiagnosticBundleExport caseId="case_001" />);

    await userEvent.click(screen.getByRole('button', { name: /request export/i }));

    expect(
      vi.mocked(supportConsoleClient.requestDiagnosticBundle),
    ).toHaveBeenCalledWith('case_001');
  });

  it('shows operation_id after successful request', async () => {
    render(<DiagnosticBundleExport caseId="case_001" />);

    await userEvent.click(screen.getByRole('button', { name: /request export/i }));

    await waitFor(() => {
      expect(screen.getByText(/op_001/)).toBeInTheDocument();
    });
  });
});
