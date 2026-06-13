import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MarginDashboard from '../pages/MarginDashboard';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarginDashboard', () => {
  it('shows error alert when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    render(<MarginDashboard />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders margin rows on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        snapshots: [
          {
            snapshot_id: 's1',
            period_start: '2026-01-01',
            period_end: '2026-12-31',
            revenue_usd: 0,
            cost_usd: 100,
            margin_usd: -100,
          },
        ],
      }),
    }));

    render(<MarginDashboard />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('margin-row-s1')).toBeInTheDocument();
    });
  });
});
