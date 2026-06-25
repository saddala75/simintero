import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchPanel } from '../components/SearchPanel.js';
function makeClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children }) {
    return _jsx(QueryClientProvider, { client: makeClient(), children: children });
}
afterEach(() => vi.restoreAllMocks());
describe('SearchPanel', () => {
    it('renders the search input', () => {
        render(_jsx(SearchPanel, {}), { wrapper: Wrapper });
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });
    it('shows empty state when no query has been submitted', () => {
        render(_jsx(SearchPanel, {}), { wrapper: Wrapper });
        expect(screen.getByTestId('search-empty-state')).toBeInTheDocument();
    });
    it('renders results grouped by entity_type on successful fetch', async () => {
        const mockResponse = {
            results: [
                { entity_type: 'case', entity_id: 'case_001', metadata: {}, score: 1.0 },
            ],
            total: 1,
            query_hash: 'abc123',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        }));
        render(_jsx(SearchPanel, {}), { wrapper: Wrapper });
        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'case001' } });
        fireEvent.click(screen.getByRole('button', { name: /search/i }));
        await waitFor(() => {
            expect(screen.getByTestId('search-result-case_001')).toBeInTheDocument();
        });
    });
    it('shows an error alert when fetch returns a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
        }));
        render(_jsx(SearchPanel, {}), { wrapper: Wrapper });
        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'failquery' } });
        fireEvent.click(screen.getByRole('button', { name: /search/i }));
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });
});
