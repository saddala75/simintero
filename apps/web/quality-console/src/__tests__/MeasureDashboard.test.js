import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MeasureDashboard from '../pages/MeasureDashboard';
function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children }) {
    return (_jsx(MemoryRouter, { children: _jsx(QueryClientProvider, { client: makeClient(), children: children }) }));
}
afterEach(() => {
    vi.restoreAllMocks();
});
describe('MeasureDashboard', () => {
    it('renders measure cards on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                runs: [
                    { run_id: 'run-1', measure_ref: 'meas-colorectal', period_start: '2026-01-01', period_end: '2026-12-31', status: 'complete' },
                ],
            }),
        }));
        render(_jsx(MeasureDashboard, {}), { wrapper: Wrapper });
        await waitFor(() => {
            expect(screen.getByText('meas-colorectal')).toBeInTheDocument();
        });
    });
    it('shows error alert when fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(_jsx(MeasureDashboard, {}), { wrapper: Wrapper });
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });
});
