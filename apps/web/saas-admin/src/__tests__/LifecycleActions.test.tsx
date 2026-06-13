import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Tenant } from '../api/controlPlaneClient.js';

vi.mock('../api/controlPlaneClient.js', () => ({
  controlPlaneClient: {
    suspendTenant: vi.fn().mockResolvedValue(undefined),
    archiveTenant: vi.fn().mockResolvedValue(undefined),
  },
}));

import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { LifecycleActions } from '../components/LifecycleActions.js';

const ACTIVE_TENANT: Tenant = {
  tenant_id: 't_001',
  display: 'Acme Health',
  tier: 'pooled',
  env_kind: 'prod',
  env_group: 'acme-health',
  compliance_baseline: 'MA',
  status: 'active',
  cell_id: 'cell-pooled-us1',
  created_at: '2026-01-01T00:00:00Z',
};

const DECOMMISSIONED_TENANT: Tenant = {
  ...ACTIVE_TENANT,
  status: 'decommissioned',
};

const SUSPENDED_TENANT: Tenant = {
  ...ACTIVE_TENANT,
  status: 'suspended',
};

const ARCHIVED_TENANT: Tenant = {
  ...ACTIVE_TENANT,
  status: 'archived',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(controlPlaneClient.suspendTenant).mockResolvedValue(undefined);
  vi.mocked(controlPlaneClient.archiveTenant).mockResolvedValue(undefined);
});

describe('LifecycleActions', () => {
  it('"Suspend" button is disabled when status is decommissioned', () => {
    render(<LifecycleActions tenant={DECOMMISSIONED_TENANT} />);
    expect(screen.getByTestId('btn-suspend')).toBeDisabled();
  });

  it('"Archive" button is disabled when status is decommissioned', () => {
    render(<LifecycleActions tenant={DECOMMISSIONED_TENANT} />);
    expect(screen.getByTestId('btn-archive')).toBeDisabled();
  });

  it('"Suspend" button is disabled when already suspended', () => {
    render(<LifecycleActions tenant={SUSPENDED_TENANT} />);
    expect(screen.getByTestId('btn-suspend')).toBeDisabled();
  });

  it('"Archive" button is disabled when already archived', () => {
    render(<LifecycleActions tenant={ARCHIVED_TENANT} />);
    expect(screen.getByTestId('btn-archive')).toBeDisabled();
  });

  it('clicking "Suspend" when active opens confirmation modal', async () => {
    const user = userEvent.setup();
    render(<LifecycleActions tenant={ACTIVE_TENANT} />);

    await user.click(screen.getByTestId('btn-suspend'));

    expect(screen.getByTestId('lifecycle-modal')).toBeInTheDocument();
    expect(screen.getByText(/Confirm Suspend/i)).toBeInTheDocument();
  });

  it('clicking "Archive" when active opens confirmation modal', async () => {
    const user = userEvent.setup();
    render(<LifecycleActions tenant={ACTIVE_TENANT} />);

    await user.click(screen.getByTestId('btn-archive'));

    expect(screen.getByTestId('lifecycle-modal')).toBeInTheDocument();
    expect(screen.getByText(/Confirm Archive/i)).toBeInTheDocument();
  });

  it('modal shows reason field', async () => {
    const user = userEvent.setup();
    render(<LifecycleActions tenant={ACTIVE_TENANT} />);

    await user.click(screen.getByTestId('btn-suspend'));

    expect(screen.getByTestId('reason-input')).toBeInTheDocument();
  });

  it('confirming suspend calls suspendTenant with the provided reason', async () => {
    const user = userEvent.setup();
    render(<LifecycleActions tenant={ACTIVE_TENANT} />);

    await user.click(screen.getByTestId('btn-suspend'));

    const reasonInput = screen.getByTestId('reason-input');
    await user.type(reasonInput, 'Non-payment');

    await user.click(screen.getByTestId('btn-confirm'));

    await waitFor(() => {
      expect(controlPlaneClient.suspendTenant).toHaveBeenCalledWith('t_001', 'Non-payment');
    });
  });

  it('clicking Cancel closes the modal without calling API', async () => {
    const user = userEvent.setup();
    render(<LifecycleActions tenant={ACTIVE_TENANT} />);

    await user.click(screen.getByTestId('btn-suspend'));
    expect(screen.getByTestId('lifecycle-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('btn-cancel'));

    expect(screen.queryByTestId('lifecycle-modal')).not.toBeInTheDocument();
    expect(controlPlaneClient.suspendTenant).not.toHaveBeenCalled();
  });
});
