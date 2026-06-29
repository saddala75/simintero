import Keycloak from 'keycloak-js'

export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'keycloak'
const _mockRequested = AUTH_MODE === 'mock'
const _onLocalhost =
  typeof location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
export const IS_MOCK = _mockRequested && _onLocalhost

export const MOCK_BEARER = import.meta.env.VITE_MOCK_BEARER ?? 'test-bearer-token'

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8081',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'simintero',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'enstellar-app',
})

export function currentBearer(): string | null {
  if (typeof window !== 'undefined' && (window as any).__SIM_BEARER__) {
    return (window as any).__SIM_BEARER__
  }
  if (keycloak.token) return keycloak.token
  if (IS_MOCK) return MOCK_BEARER
  return null
}
