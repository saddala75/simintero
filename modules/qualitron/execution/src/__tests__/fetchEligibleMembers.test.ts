import { describe, it, expect, vi } from 'vitest';
import { fetchEligibleMembers } from '../activities/fetchEligibleMembers.js';

describe('fetchEligibleMembers', () => {
  it('returns distinct member_refs of Patient resources', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ member_ref: 'member-001' }, { member_ref: 'member-002' }] });
    const client = { query } as any;
    const members = await fetchEligibleMembers(client);
    expect(members).toEqual(['member-001', 'member-002']);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/FROM fabric\.resource/i);
    expect(sql).toMatch(/resource_type = 'Patient'/);
    expect(sql).toMatch(/current_setting\('sim\.tenant_id'/);
    // slice 2.4b: AI-extracted evidence (source='ai-extraction') is advisory-only and
    // must never be counted in the eligible-member denominator.
    expect(sql).toMatch(/source <> 'ai-extraction'/);
  });

  it('empty when no patients', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    expect(await fetchEligibleMembers(client)).toEqual([]);
  });
});
