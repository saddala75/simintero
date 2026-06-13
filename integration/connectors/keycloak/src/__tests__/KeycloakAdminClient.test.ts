import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeycloakAdminClient } from '../KeycloakAdminClient.js';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
import { fetch } from 'undici';

describe('KeycloakAdminClient', () => {
  const cfg = {
    baseUrl: 'https://auth.simintero.io',
    realm: 'simintero',
    clientId: 'control-plane',
    clientSecret: 'test-secret',
  };
  let client: KeycloakAdminClient;

  const mockTokenResponse = {
    access_token: 'eyJtest.token.here',
    expires_in: 300,
  };

  function mockToken() {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockTokenResponse,
    } as unknown as Response);
  }

  beforeEach(() => {
    client = new KeycloakAdminClient(cfg);
    vi.resetAllMocks();
  });

  it('getAdminToken fetches and caches client_credentials token', async () => {
    mockToken();

    const token = await client.getAdminToken();
    expect(token).toBe('eyJtest.token.here');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://auth.simintero.io/realms/simintero/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' }),
    );

    const token2 = await client.getAdminToken();
    expect(token2).toBe('eyJtest.token.here');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('createUser returns UUID from Location header', async () => {
    mockToken();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: {
        get: (name: string) =>
          name === 'location'
            ? 'https://auth.simintero.io/admin/realms/simintero/users/abc-123-uuid'
            : null,
      },
    } as unknown as Response);

    const uuid = await client.createUser({
      username: 'jdoe',
      email: 'jdoe@tenant.com',
      firstName: 'Jane',
      lastName: 'Doe',
      enabled: true,
      realmRoles: [],
    });

    expect(uuid).toBe('abc-123-uuid');
  });

  it('createUser throws USER_EXISTS on 409', async () => {
    mockToken();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
    } as unknown as Response);

    await expect(
      client.createUser({
        username: 'jdoe',
        email: 'jdoe@tenant.com',
        firstName: 'Jane',
        lastName: 'Doe',
        enabled: true,
        realmRoles: [],
      }),
    ).rejects.toThrow('USER_EXISTS');
  });

  it('createTenantGroup returns group UUID from Location header', async () => {
    mockToken();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: {
        get: (name: string) =>
          name === 'location'
            ? 'https://auth.simintero.io/admin/realms/simintero/groups/grp-tenant-001'
            : null,
      },
    } as unknown as Response);

    const groupId = await client.createTenantGroup('tenant-001');
    expect(groupId).toBe('grp-tenant-001');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
