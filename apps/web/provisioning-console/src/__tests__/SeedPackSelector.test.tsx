import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/vkasClient.js', () => ({
  vkasClient: {
    getSeedPacks: vi.fn(),
  },
}));

import { vkasClient } from '../api/vkasClient.js';
import { SeedPackSelector } from '../components/SeedPackSelector.js';

const MA_PACK = {
  canonical_url: 'urn:sim:pack:ma-001',
  version: '1.0.0',
  artifact_type: 'cql_library',
  lob: 'MA',
};

const MEDICAID_PACK = {
  canonical_url: 'urn:sim:pack:medicaid-001',
  version: '1.0.0',
  artifact_type: 'cql_library',
  lob: 'MEDICAID',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SeedPackSelector', () => {
  it('shows packs with matching lob', async () => {
    vi.mocked(vkasClient.getSeedPacks).mockResolvedValue([MA_PACK, MEDICAID_PACK]);

    render(<SeedPackSelector lob="MA" onSelect={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/urn:sim:pack:ma-001/)).toBeInTheDocument();
    });

    // MEDICAID pack should not appear since component filters by lob
    expect(screen.queryByText(/urn:sim:pack:medicaid-001/)).not.toBeInTheDocument();
  });

  it('selecting a pack calls onSelect with the canonical_url', async () => {
    vi.mocked(vkasClient.getSeedPacks).mockResolvedValue([MA_PACK]);

    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<SeedPackSelector lob="MA" onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /urn:sim:pack:ma-001/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('radio', { name: /urn:sim:pack:ma-001/i }));

    expect(onSelect).toHaveBeenCalledWith('urn:sim:pack:ma-001');
  });
});
