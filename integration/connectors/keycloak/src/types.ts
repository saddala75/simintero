export interface KeycloakConfig {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

export interface KeycloakUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  realmRoles: string[];
}

export interface KeycloakTenantGroup {
  id: string;
  name: string;
  attributes: Record<string, string[]>;
}

export interface KeycloakRole {
  id: string;
  name: string;
  composite: boolean;
  clientRole: boolean;
  containerId: string;
}

export interface TokenCache {
  accessToken: string;
  expiresAt: number;
}
