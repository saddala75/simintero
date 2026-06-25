import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import GapTable from '../components/GapTable';
const mockGaps = [
    {
        gap_id: 'gap-1',
        member_id: 'member-001',
        measure_ref: 'meas-colorectal',
        period_start: '2026-01-01',
        period_end: '2026-12-31',
        gap_type: 'missing_numerator',
        status: 'open',
        detected_at: '2026-06-01T00:00:00Z',
        task_id: 'task-123',
    },
    {
        gap_id: 'gap-2',
        member_id: 'member-002',
        measure_ref: 'meas-colorectal',
        period_start: '2026-01-01',
        period_end: '2026-12-31',
        gap_type: 'missing_numerator',
        status: 'open',
        detected_at: '2026-06-02T00:00:00Z',
        task_id: null,
    },
];
describe('GapTable', () => {
    it('renders gap rows', () => {
        render(_jsx(GapTable, { gaps: mockGaps, statusFilter: "open", onStatusFilterChange: () => { } }));
        expect(screen.getByTestId('gap-row-gap-1')).toBeInTheDocument();
        expect(screen.getByTestId('gap-row-gap-2')).toBeInTheDocument();
    });
    it('shows empty state when no gaps', () => {
        render(_jsx(GapTable, { gaps: [], statusFilter: "open", onStatusFilterChange: () => { } }));
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    it('renders task_id when present and dash when absent', () => {
        render(_jsx(GapTable, { gaps: mockGaps, statusFilter: "open", onStatusFilterChange: () => { } }));
        expect(screen.getByTestId('gap-row-gap-1')).toHaveTextContent('task-123');
        expect(screen.getByTestId('gap-row-gap-2')).toHaveTextContent('—');
    });
});
