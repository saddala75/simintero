import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { keycloak, IS_MOCK, MOCK_ROLES } from './keycloak'

export interface AuthState {
  ready: boolean
  authenticated: boolean
  roles: string[]
  sub: string
  tenantId: string
  displayName: string
  login: () => void
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)
export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
export const hasRole = (auth: AuthState, role: string) => auth.roles.includes(role)

function mkState(authd: boolean): AuthState {
  if (IS_MOCK) {
    return {
      ready: true, authenticated: true, roles: MOCK_ROLES,
      sub: 'mock-sub', tenantId: 'tenant-dev', displayName: 'Mock Reviewer',
      login: () => {}, logout: () => {},
    }
  }
  const t = keycloak.tokenParsed as Record<string, any> | undefined
  return {
    ready: true,
    authenticated: authd,
    roles: (t?.realm_access?.roles as string[]) ?? [],
    sub: t?.sub ?? '',
    tenantId: t?.tenant_id ?? '',
    displayName: t?.name ?? t?.preferred_username ?? '',
    login: () => keycloak.login(),
    logout: () => keycloak.logout({ redirectUri: window.location.origin }),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (IS_MOCK ? mkState(true) : { ...mkState(false), ready: false }))

  useEffect(() => {
    if (IS_MOCK) return
    keycloak
      .init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      })
      .then((authd) => {
        setState(mkState(authd))
        if (authd) setInterval(() => keycloak.updateToken(60).catch(() => {}), 30_000)
      })
      .catch(() => setState(mkState(false)))
    keycloak.onAuthRefreshSuccess = () => setState(mkState(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

/** Gate app routes: trigger login if unauthenticated. The public landing is NOT wrapped. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (!auth.ready) return null
  if (!auth.authenticated) { auth.login(); return null }
  return <>{children}</>
}
