import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityTimeline } from '../components/ActivityTimeline.js';

const ACTIVITIES = [
  { name: 'ProcessIntakeCommand', status: 'COMPLETED', startedAt: '2026-06-01T10:00:00Z' },
  { name: 'callRuntimeEvaluate', status: 'COMPLETED', startedAt: '2026-06-01T10:00:05Z' },
  { name: 'requestAdvisoryAnalysis', status: 'FAILED', startedAt: '2026-06-01T10:00:10Z' },
];

describe('ActivityTimeline', () => {
  it('renders each activity name', () => {
    render(<ActivityTimeline activities={ACTIVITIES} />);
    expect(screen.getByText('ProcessIntakeCommand')).toBeInTheDocument();
    expect(screen.getByText('requestAdvisoryAnalysis')).toBeInTheDocument();
  });

  it('marks failed activities with a visual indicator', () => {
    render(<ActivityTimeline activities={ACTIVITIES} />);
    const failedItem = screen.getByText('requestAdvisoryAnalysis').closest('[data-status]');
    expect(failedItem?.getAttribute('data-status')).toBe('FAILED');
  });
});
