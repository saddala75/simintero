import Keycloak from 'keycloak-js'

export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'keycloak'
const _mockRequested = AUTH_MODE === 'mock'
const _onLocalhost =
  typeof location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
export const IS_MOCK = _mockRequested && _onLocalhost
if (_mockRequested && !_onLocalhost) {
  // eslint-disable-next-line no-console
  console.warn('VITE_AUTH_MODE=mock ignored on a non-localhost origin — using real Keycloak.')
}

// Fixed identity used ONLY in mock mode (tests/dev). Roles overridable so specs
// can exercise role-gated UI later (comma-separated).
export const MOCK_ROLES = (import.meta.env.VITE_MOCK_ROLES ??
  'reviewer,clinical-reviewer,medical_director,appeals_coordinator,grievance_coordinator')
  .split(',').map((r: string) => r.trim()).filter(Boolean)
export const MOCK_BEARER = import.meta.env.VITE_MOCK_BEARER ?? 'test-bearer-token'

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8081',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'simintero',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'enstellar-app',
})

/** Live bearer for apiFetch: the KC token, or the fixed mock bearer in mock mode. */
export function currentBearer(): string | null {
  if (IS_MOCK) {
    if (typeof window !== 'undefined') (window as any).__SIM_BEARER__ = MOCK_BEARER
    return MOCK_BEARER
  }
  const token = keycloak.token ?? null
  if (typeof window !== 'undefined' && token) {
    ;(window as any).__SIM_BEARER__ = token
  }
  return token
}
