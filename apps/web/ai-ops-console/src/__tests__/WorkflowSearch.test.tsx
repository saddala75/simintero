import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowSearch } from '../components/WorkflowSearch.js';

describe('WorkflowSearch', () => {
  it('renders a search input and button', () => {
    render(<WorkflowSearch onResult={vi.fn()} />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('calls onResult with workflow data after a successful fetch', async () => {
    const mockResult = {
      workflowId: 'case_01J123',
      status: 'COMPLETED',
      activities: [{ name: 'ProcessIntakeCommand', status: 'COMPLETED', startedAt: '2026-06-01T10:00:00Z' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
    }));

    const onResult = vi.fn();
    render(<WorkflowSearch onResult={onResult} />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'case_01J123' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(mockResult);
    });
  });

  it('shows an error message when the workflow is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<WorkflowSearch onResult={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'case_unknown' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
