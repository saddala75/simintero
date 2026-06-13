import { fetch } from 'undici';
import type {
  KeycloakConfig,
  KeycloakUser,
  KeycloakTenantGroup,
  KeycloakRole,
  TokenCache,
} from './types.js';

export class KeycloakAdminClient {
  private tokenCache: TokenCache | null = null;

  constructor(private cfg: KeycloakConfig) {}

  async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt - 30_000) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = `${this.cfg.baseUrl}/realms/${this.cfg.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`Keycloak token fetch failed: ${res.status}`);

    const data = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return this.tokenCache.accessToken;
  }

  private async adminHeaders(): Promise<Record<string, string>> {
    const token = await this.getAdminToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private get adminBase(): string {
    return `${this.cfg.baseUrl}/admin/realms/${this.cfg.realm}`;
  }

  async createUser(user: Omit<KeycloakUser, 'id'>): Promise<string> {
    const headers = await this.adminHeaders();
    const res = await fetch(`${this.adminBase}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: user.enabled,
      }),
    });

    if (res.status === 409) {
      throw new Error('USER_EXISTS');
    }
    if (!res.ok) throw new Error(`Keycloak createUser failed: ${res.status}`);

    const location = res.headers.get('location') ?? '';
    const uuid = location.split('/').pop() ?? '';
    if (!uuid) throw new Error('Keycloak createUser: no UUID in Location header');
    return uuid;
  }

  async assignRealmRole(userId: string, roleName: string): Promise<void> {
    const headers = await this.adminHeaders();

    const roleRes = await fetch(`${this.adminBase}/roles/${encodeURIComponent(roleName)}`, {
      headers,
    });
    if (!roleRes.ok) throw new Error(`Keycloak role '${roleName}' not found: ${roleRes.status}`);
    const role = await roleRes.json() as KeycloakRole;

    const mappingRes = await fetch(`${this.adminBase}/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      headers,
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });
    if (!mappingRes.ok) {
      throw new Error(`Keycloak assignRealmRole failed: ${mappingRes.status}`);
    }
  }

  async createTenantGroup(tenantId: string): Promise<string> {
    const headers = await this.adminHeaders();
    const res = await fetch(`${this.adminBase}/groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: tenantId, attributes: { tenant_id: [tenantId] } }),
    });

    if (!res.ok) throw new Error(`Keycloak createTenantGroup failed: ${res.status}`);

    const location = res.headers.get('location') ?? '';
    const uuid = location.split('/').pop() ?? '';
    if (!uuid) throw new Error('Keycloak createTenantGroup: no UUID in Location header');
    return uuid;
  }

  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    const headers = await this.adminHeaders();
    const res = await fetch(`${this.adminBase}/users/${userId}/groups/${groupId}`, {
      method: 'PUT',
      headers,
    });
    if (!res.ok) throw new Error(`Keycloak addUserToGroup failed: ${res.status}`);
  }

  async getTenantGroup(tenantId: string): Promise<KeycloakTenantGroup | null> {
    const headers = await this.adminHeaders();
    const params = new URLSearchParams({ search: tenantId, exact: 'true' });
    const res = await fetch(`${this.adminBase}/groups?${params}`, { headers });
    if (!res.ok) throw new Error(`Keycloak getTenantGroup failed: ${res.status}`);
    const groups = await res.json() as KeycloakTenantGroup[];
    return groups[0] ?? null;
  }
}
