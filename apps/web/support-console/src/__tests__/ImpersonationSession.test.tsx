import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImpersonationSession from '../pages/ImpersonationSession.js';
import { supportConsoleClient } from '../api/supportConsoleClient.js';

vi.mock('../api/supportConsoleClient.js', () => ({
  supportConsoleClient: {
    startImpersonation: vi.fn(),
    endImpersonation: vi.fn().mockResolvedValue(undefined),
    getCaseTimeline: vi.fn().mockResolvedValue([]),
    requestDiagnosticBundle: vi.fn().mockResolvedValue({ operation_id: 'op_001' }),
  },
}));

describe('ImpersonationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supportConsoleClient.endImpersonation).mockResolvedValue(undefined);
  });

  it('shows "Enclave tenants cannot be impersonated" when SIM-PLAT-0020 is returned', async () => {
    const error = Object.assign(new Error('Enclave tenant'), {
      code: 'SIM-PLAT-0020',
      status: 403,
    });
    vi.mocked(supportConsoleClient.startImpersonation).mockRejectedValue(error);

    render(<ImpersonationSession />);

    await userEvent.type(screen.getByLabelText(/tenant/i), 'tenant-enclave');
    await userEvent.type(screen.getByLabelText(/reason/i), 'Debug issue');
    await userEvent.click(screen.getByRole('button', { name: /start session/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/enclave tenants cannot be impersonated/i),
      ).toBeInTheDocument();
    });
  });

  it('shows ImpersonationBanner on successful impersonation', async () => {
    vi.mocked(supportConsoleClient.startImpersonation).mockResolvedValue({
      session_token: 'tok_123',
      expires_at: '2026-06-12T12:00:00Z',
      tenant_id: 'tenant-abc',
    });

    render(<ImpersonationSession />);

    await userEvent.type(screen.getByLabelText(/tenant/i), 'tenant-abc');
    await userEvent.type(screen.getByLabelText(/reason/i), 'Debug issue');
    await userEvent.click(screen.getByRole('button', { name: /start session/i }));

    await waitFor(() => {
      expect(screen.getByText(/impersonating/i)).toBeInTheDocument();
    });
  });

  it('"End Session" calls endImpersonation and hides the banner', async () => {
    vi.mocked(supportConsoleClient.startImpersonation).mockResolvedValue({
      session_token: 'tok_123',
      expires_at: '2026-06-12T12:00:00Z',
      tenant_id: 'tenant-abc',
    });

    render(<ImpersonationSession />);

    await userEvent.type(screen.getByLabelText(/tenant/i), 'tenant-abc');
    await userEvent.type(screen.getByLabelText(/reason/i), 'Debug issue');
    await userEvent.click(screen.getByRole('button', { name: /start session/i }));

    await waitFor(() => {
      expect(screen.getByText(/impersonating/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /end session/i }));

    await waitFor(() => {
      expect(vi.mocked(supportConsoleClient.endImpersonation)).toHaveBeenCalledWith('tok_123');
      expect(screen.queryByText(/impersonating/i)).not.toBeInTheDocument();
    });
  });
});
