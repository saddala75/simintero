import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import GapList from '../pages/GapList';
function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children }) {
    return (_jsx(MemoryRouter, { children: _jsx(QueryClientProvider, { client: makeClient(), children: children }) }));
}
afterEach(() => {
    vi.restoreAllMocks();
});
describe('GapList', () => {
    it('renders gap rows on success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                gaps: [
                    {
                        gap_id: 'gap-1',
                        member_id: 'member-001',
                        measure_ref: 'meas-colorectal',
                        period_start: '2026-01-01',
                        period_end: '2026-12-31',
                        gap_type: 'missing_numerator',
                        status: 'open',
                        detected_at: '2026-06-01T00:00:00Z',
                        task_id: null,
                    },
                ],
            }),
        }));
        render(_jsx(GapList, {}), { wrapper: Wrapper });
        await waitFor(() => {
            expect(screen.getByTestId('gap-row-gap-1')).toBeInTheDocument();
        });
    });
    it('shows error alert when fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(_jsx(GapList, {}), { wrapper: Wrapper });
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });
    it('shows empty state when no gaps returned', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ gaps: [] }),
        }));
        render(_jsx(GapList, {}), { wrapper: Wrapper });
        await waitFor(() => {
            expect(screen.getByTestId('empty-state')).toBeInTheDocument();
        });
    });
});
