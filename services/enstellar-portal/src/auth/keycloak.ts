import Keycloak from 'keycloak-js'

export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'keycloak'
export const IS_MOCK = AUTH_MODE === 'mock'

// Fixed identity used ONLY in mock mode (tests/dev). Roles overridable so specs
// can exercise role-gated UI later (comma-separated).
export const MOCK_ROLES = (import.meta.env.VITE_MOCK_ROLES ??
  'reviewer,clinical-reviewer,medical_director,appeals_coordinator,grievance_coordinator')
  .split(',').map((r: string) => r.trim()).filter(Boolean)
export const MOCK_BEARER = import.meta.env.VITE_MOCK_BEARER ?? 'test-bearer-token'

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'simintero',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'enstellar-app',
})

/** Live bearer for apiFetch: the KC token, or the fixed mock bearer in mock mode. */
export function currentBearer(): string | null {
  if (IS_MOCK) return MOCK_BEARER
  return keycloak.token ?? null
}
