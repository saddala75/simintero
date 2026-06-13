import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../api/controlPlaneClient.js', () => ({
  controlPlaneClient: {
    getOperation: vi.fn(),
  },
}));

import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { ProvisioningStatus } from '../pages/ProvisioningStatus.js';

const RUNNING_OP = {
  operation_id: 'op_001',
  kind: 'provision_tenant',
  tenant_id: 't_001',
  status: 'running' as const,
  result: null,
  created_at: '2026-01-01T00:00:00Z',
};

const COMPLETED_OP = { ...RUNNING_OP, status: 'completed' as const };
const FAILED_OP = { ...RUNNING_OP, status: 'failed' as const };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProvisioningStatus', () => {
  it('shows "running" status initially', async () => {
    vi.mocked(controlPlaneClient.getOperation).mockResolvedValue(RUNNING_OP);

    render(<ProvisioningStatus operationId="op_001" />);

    // Flush the initial async poll
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('operation-status')).toHaveTextContent('running');
  });

  it('shows "completed" when operation status transitions', async () => {
    vi.mocked(controlPlaneClient.getOperation)
      .mockResolvedValueOnce(RUNNING_OP)
      .mockResolvedValue(COMPLETED_OP);

    render(<ProvisioningStatus operationId="op_001" />);

    // Flush initial poll -> running
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('operation-status')).toHaveTextContent('running');

    // Advance timer to trigger second poll
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('operation-status')).toHaveTextContent('completed');
  });

  it('polling stops when status is "completed" (no more calls after terminal state)', async () => {
    vi.mocked(controlPlaneClient.getOperation).mockResolvedValue(COMPLETED_OP);

    render(<ProvisioningStatus operationId="op_001" />);

    // Flush initial poll -> completed -> interval cleared
    await act(async () => {
      await Promise.resolve();
    });

    const callsAfterFirst = vi.mocked(controlPlaneClient.getOperation).mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Advance well past several intervals — interval should be cleared
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(controlPlaneClient.getOperation).mock.calls.length).toBe(callsAfterFirst);
  });

  it('polling stops when status is "failed"', async () => {
    vi.mocked(controlPlaneClient.getOperation).mockResolvedValue(FAILED_OP);

    render(<ProvisioningStatus operationId="op_001" />);

    await act(async () => {
      await Promise.resolve();
    });

    const callsAfterFirst = vi.mocked(controlPlaneClient.getOperation).mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(vi.mocked(controlPlaneClient.getOperation).mock.calls.length).toBe(callsAfterFirst);
  });
});
