import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/controlPlaneClient.js', () => ({
  controlPlaneClient: {
    createTenant: vi.fn().mockResolvedValue({ tenant_id: 't_new', operation_id: 'op_001' }),
    getOperation: vi.fn().mockResolvedValue({ operation_id: 'op_001', status: 'running' }),
  },
}));
vi.mock('../api/vkasClient.js', () => ({
  vkasClient: {
    getSeedPacks: vi.fn().mockResolvedValue([]),
  },
}));

import { NewTenantWizard } from '../pages/NewTenant/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewTenantWizard', () => {
  it('Step 1 renders display name, env_kind, env_group, and compliance_baseline fields', () => {
    render(<NewTenantWizard onComplete={vi.fn()} />);

    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/environment kind/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/environment group/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/compliance baseline/i)).toBeInTheDocument();
  });

  it('"Next" button is disabled on Step 1 when display name is empty', () => {
    render(<NewTenantWizard onComplete={vi.fn()} />);

    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('filling all Step 1 fields enables the Next button', async () => {
    const user = userEvent.setup();
    render(<NewTenantWizard onComplete={vi.fn()} />);

    await user.type(screen.getByLabelText(/display name/i), 'Test Tenant');
    await user.selectOptions(screen.getByLabelText(/environment kind/i), 'sandbox');
    await user.type(screen.getByLabelText(/environment group/i), 'test-group');
    await user.selectOptions(screen.getByLabelText(/compliance baseline/i), 'MA');

    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('clicking Next after filling Step 1 advances to Step 2', async () => {
    const user = userEvent.setup();
    render(<NewTenantWizard onComplete={vi.fn()} />);

    await user.type(screen.getByLabelText(/display name/i), 'Test Tenant');
    await user.selectOptions(screen.getByLabelText(/environment kind/i), 'sandbox');
    await user.type(screen.getByLabelText(/environment group/i), 'test-group');
    await user.selectOptions(screen.getByLabelText(/compliance baseline/i), 'MA');

    await user.click(screen.getByRole('button', { name: /next/i }));

    // Step 2: Infrastructure fields
    expect(screen.getByLabelText(/tier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
  });
});
