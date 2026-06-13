import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SLAMetricsPanel } from '../components/SLAMetricsPanel.js';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('SLAMetricsPanel', () => {
  it('renders metric name and value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: 42, label: 'Cases in Clinical Review', unit: 'cases' }),
    }));

    render(
      <SLAMetricsPanel metricKey="worklist_age" label="Worklist Age" endpoint="/api/metrics/worklist-age" />,
      { wrapper }
    );

    expect(await screen.findByText('Worklist Age')).toBeInTheDocument();
    expect(await screen.findByText('42')).toBeInTheDocument();
  });

  it('shows error state when metric endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(
      <SLAMetricsPanel metricKey="broken" label="Broken Metric" endpoint="/api/metrics/broken" />,
      { wrapper }
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
