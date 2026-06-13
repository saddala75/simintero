import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from '../components/ActionBar.js';

function renderActionBar(roles: string[]) {
  const onRequestInfo = vi.fn();
  const onRoute = vi.fn();
  const onRecordDetermination = vi.fn();
  render(
    <ActionBar
      roles={roles}
      caseId="case_001"
      onRequestInfo={onRequestInfo}
      onRoute={onRoute}
      onRecordDetermination={onRecordDetermination}
    />,
  );
  return { onRequestInfo, onRoute, onRecordDetermination };
}

describe('ActionBar', () => {
  it('shows "Record Determination" button when role is medical_director', () => {
    renderActionBar(['medical_director']);
    expect(screen.getByRole('button', { name: /record determination/i })).toBeInTheDocument();
  });

  it('does NOT show "Record Determination" for role um_nurse', () => {
    renderActionBar(['um_nurse']);
    expect(screen.queryByRole('button', { name: /record determination/i })).not.toBeInTheDocument();
  });

  it('clicking "Record Determination" calls onRecordDetermination', async () => {
    const user = userEvent.setup();
    const { onRecordDetermination } = renderActionBar(['medical_director']);
    await user.click(screen.getByRole('button', { name: /record determination/i }));
    expect(onRecordDetermination).toHaveBeenCalledOnce();
  });

  it('always shows "Request Additional Info" and "Route to Peer Review" buttons', () => {
    renderActionBar(['um_nurse']);
    expect(screen.getByRole('button', { name: /request additional info/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /route to peer review/i })).toBeInTheDocument();
  });

  it('also shows always-visible buttons for medical_director', () => {
    renderActionBar(['medical_director']);
    expect(screen.getByRole('button', { name: /request additional info/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /route to peer review/i })).toBeInTheDocument();
  });
});
