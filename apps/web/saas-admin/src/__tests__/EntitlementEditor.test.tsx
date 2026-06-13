import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entitlement } from '../api/controlPlaneClient.js';

vi.mock('../api/controlPlaneClient.js', () => ({
  controlPlaneClient: {
    patchEntitlement: vi.fn(),
  },
}));

import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { EntitlementEditor } from '../components/EntitlementEditor.js';

const MOCK_ENTITLEMENTS: Entitlement[] = [
  {
    tenant_id: 't_001',
    key: 'max_users',
    value: '100',
    expires_at: null,
  },
  {
    tenant_id: 't_001',
    key: 'max_payers',
    value: '5',
    expires_at: '2026-12-31T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EntitlementEditor', () => {
  it('renders entitlement rows', () => {
    render(<EntitlementEditor tenantId="t_001" entitlements={MOCK_ENTITLEMENTS} />);

    expect(screen.getByText('max_users')).toBeInTheDocument();
    expect(screen.getByText('max_payers')).toBeInTheDocument();
    expect(screen.getByTestId('value-max_users')).toHaveTextContent('100');
    expect(screen.getByTestId('value-max_payers')).toHaveTextContent('5');
  });

  it('clicking Edit enters edit mode for that row', async () => {
    const user = userEvent.setup();
    render(<EntitlementEditor tenantId="t_001" entitlements={MOCK_ENTITLEMENTS} />);

    const editBtn = screen.getByLabelText('Edit max_users');
    await user.click(editBtn);

    const input = screen.getByLabelText('Edit value for max_users');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('100');
    expect(screen.getByLabelText('Save max_users')).toBeInTheDocument();
  });

  it('changing value and clicking Save calls patchEntitlement with new value', async () => {
    const user = userEvent.setup();
    const updatedEntitlement: Entitlement = {
      tenant_id: 't_001',
      key: 'max_users',
      value: '200',
      expires_at: null,
    };
    vi.mocked(controlPlaneClient.patchEntitlement).mockResolvedValue(updatedEntitlement);

    render(<EntitlementEditor tenantId="t_001" entitlements={MOCK_ENTITLEMENTS} />);

    await user.click(screen.getByLabelText('Edit max_users'));

    const input = screen.getByLabelText('Edit value for max_users');
    await user.clear(input);
    await user.type(input, '200');

    await user.click(screen.getByLabelText('Save max_users'));

    await waitFor(() => {
      expect(controlPlaneClient.patchEntitlement).toHaveBeenCalledWith(
        't_001',
        'max_users',
        '200',
        null,
      );
    });
  });

  it('on error, reverts to original value', async () => {
    const user = userEvent.setup();
    vi.mocked(controlPlaneClient.patchEntitlement).mockRejectedValue(
      new Error('422 Unprocessable Entity'),
    );

    render(<EntitlementEditor tenantId="t_001" entitlements={MOCK_ENTITLEMENTS} />);

    await user.click(screen.getByLabelText('Edit max_users'));

    const input = screen.getByLabelText('Edit value for max_users');
    await user.clear(input);
    await user.type(input, 'INVALID');

    await user.click(screen.getByLabelText('Save max_users'));

    await waitFor(() => {
      // After rollback, value is shown (not editing)
      expect(screen.getByTestId('value-max_users')).toHaveTextContent('100');
    });
  });
});
