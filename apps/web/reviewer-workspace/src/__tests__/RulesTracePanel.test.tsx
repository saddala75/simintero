import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RulesTracePanel } from '../components/RulesTracePanel.js';
import type { TraceCriterion } from '../types.js';

const FIXTURE_CRITERIA: TraceCriterion[] = [
  {
    expression_name: 'Diagnosis Documented',
    result: true,
    artifact_canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
    artifact_version: '1.0.0',
  },
  {
    expression_name: 'Imaging Documented',
    result: false,
    artifact_canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
    artifact_version: '1.0.0',
  },
  {
    expression_name: 'Conservative Therapy Tried',
    result: 'indeterminate',
    artifact_canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
    artifact_version: '1.0.0',
  },
];

describe('RulesTracePanel', () => {
  it('renders all 3 criterion names', () => {
    render(<RulesTracePanel criteria={FIXTURE_CRITERIA} />);
    expect(screen.getByText('Diagnosis Documented')).toBeInTheDocument();
    expect(screen.getByText('Imaging Documented')).toBeInTheDocument();
    expect(screen.getByText('Conservative Therapy Tried')).toBeInTheDocument();
  });

  it('renders met indicator (✓) for result=true', () => {
    render(<RulesTracePanel criteria={FIXTURE_CRITERIA} />);
    const metEl = screen.getByLabelText('met');
    expect(metEl).toBeInTheDocument();
    expect(metEl.textContent).toMatch(/✓/);
  });

  it('renders not-met indicator (✗) for result=false', () => {
    render(<RulesTracePanel criteria={FIXTURE_CRITERIA} />);
    const notMetEl = screen.getByLabelText('not met');
    expect(notMetEl).toBeInTheDocument();
    expect(notMetEl.textContent).toMatch(/✗/);
  });

  it('renders indeterminate indicator (?) for result=indeterminate', () => {
    render(<RulesTracePanel criteria={FIXTURE_CRITERIA} />);
    const indeterminateEl = screen.getByLabelText('indeterminate');
    expect(indeterminateEl).toBeInTheDocument();
    expect(indeterminateEl.textContent).toMatch(/\?/);
  });

  it('renders artifact canonical URL and version for each criterion', () => {
    render(<RulesTracePanel criteria={FIXTURE_CRITERIA} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);

    for (const item of items) {
      expect(within(item).getByText('urn:sim:policy:knee-arthroscopy:1.0.0')).toBeInTheDocument();
      expect(within(item).getByText('v1.0.0')).toBeInTheDocument();
    }
  });
});
