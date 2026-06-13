import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantList } from '../pages/TenantList.js';

vi.mock('../api/controlPlaneClient.js', () => ({
  controlPlaneClient: {
    getTenants: vi.fn().mockResolvedValue({
      tenants: [
        {
          tenant_id: 't_001',
          display: 'Acme Health',
          tier: 'pooled',
          env_kind: 'prod',
          env_group: 'acme-health',
          compliance_baseline: 'MA',
          status: 'active',
          cell_id: 'cell-pooled-us1',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          tenant_id: 't_002',
          display: 'Beta Corp',
          tier: 'dedicated',
          env_kind: 'sandbox',
          env_group: 'beta-corp',
          compliance_baseline: 'COMMERCIAL',
          status: 'suspended',
          cell_id: 'cell-pooled-us1',
          created_at: '2026-01-02T00:00:00Z',
        },
      ],
      limit: 50,
      offset: 0,
    }),
  },
}));

// Import after mock so the mock is in place
import { controlPlaneClient } from '../api/controlPlaneClient.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the mock to its default resolved value
  vi.mocked(controlPlaneClient.getTenants).mockResolvedValue({
    tenants: [
      {
        tenant_id: 't_001',
        display: 'Acme Health',
        tier: 'pooled',
        env_kind: 'prod',
        env_group: 'acme-health',
        compliance_baseline: 'MA',
        status: 'active',
        cell_id: 'cell-pooled-us1',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        tenant_id: 't_002',
        display: 'Beta Corp',
        tier: 'dedicated',
        env_kind: 'sandbox',
        env_group: 'beta-corp',
        compliance_baseline: 'COMMERCIAL',
        status: 'suspended',
        cell_id: 'cell-pooled-us1',
        created_at: '2026-01-02T00:00:00Z',
      },
    ],
    limit: 50,
    offset: 0,
  });
});

describe('TenantList', () => {
  it('renders a table row for each tenant in mock data', async () => {
    render(<TenantList />);

    await waitFor(() => {
      expect(screen.getByText('Acme Health')).toBeInTheDocument();
      expect(screen.getByText('Beta Corp')).toBeInTheDocument();
    });
  });

  it('renders status badges with correct status text', async () => {
    render(<TenantList />);

    await waitFor(() => {
      expect(screen.getByTestId('status-badge-active')).toBeInTheDocument();
      expect(screen.getByTestId('status-badge-active')).toHaveTextContent('active');
      expect(screen.getByTestId('status-badge-suspended')).toBeInTheDocument();
      expect(screen.getByTestId('status-badge-suspended')).toHaveTextContent('suspended');
    });
  });

  it('changing the status filter resets offset and re-fetches', async () => {
    const user = userEvent.setup();
    render(<TenantList />);

    await waitFor(() => {
      expect(screen.getByText('Acme Health')).toBeInTheDocument();
    });

    const callsBefore = vi.mocked(controlPlaneClient.getTenants).mock.calls.length;

    const statusSelect = screen.getByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'active');

    await waitFor(() => {
      const calls = vi.mocked(controlPlaneClient.getTenants).mock.calls;
      expect(calls.length).toBeGreaterThan(callsBefore);
      const lastCall = calls[calls.length - 1]![0];
      expect(lastCall?.status).toBe('active');
    });
  });

  it('calls getTenants on mount', async () => {
    render(<TenantList />);

    await waitFor(() => {
      expect(controlPlaneClient.getTenants).toHaveBeenCalledTimes(1);
    });
  });
});
