import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeterminationModal } from '../components/DeterminationModal.js';

function setup(props?: Partial<Parameters<typeof DeterminationModal>[0]>) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <DeterminationModal
      onSubmit={props?.onSubmit ?? onSubmit}
      onClose={props?.onClose ?? onClose}
    />,
  );
  return { onSubmit, onClose };
}

describe('DeterminationModal', () => {
  it('submit button is disabled when no outcome is selected', () => {
    setup();
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('submit button is enabled for outcome=approved without rationale', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox'), 'approved');
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
  });

  it('submit button is disabled for outcome=denied when rationale is empty', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox'), 'denied');
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('submit button is enabled for outcome=denied after rationale is entered', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox'), 'denied');
    await user.type(screen.getByRole('textbox'), 'Not medically necessary.');
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
  });

  it('shows validation message for denied with empty rationale', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole('combobox'), 'denied');
    expect(screen.getByText(/required for denied/i)).toBeInTheDocument();
  });

  it('calls onSubmit with correct outcome and rationale', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.selectOptions(screen.getByRole('combobox'), 'denied');
    await user.type(screen.getByRole('textbox'), 'Not medically necessary.');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('denied', 'Not medically necessary.');
  });
});
