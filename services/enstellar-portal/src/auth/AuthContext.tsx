import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { keycloak, IS_MOCK, MOCK_ROLES } from './keycloak'

let initStarted = false

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
    let refreshTimer: ReturnType<typeof setInterval> | undefined
    keycloak.onAuthRefreshSuccess = () => setState(mkState(true))
    if (!initStarted && !keycloak.didInitialize) {
      initStarted = true
      keycloak
        .init({
          onLoad: 'check-sso',
          pkceMethod: 'S256',
          silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        })
        .then((authd) => {
          setState(mkState(authd))
          if (authd) refreshTimer = setInterval(() => keycloak.updateToken(60).catch(() => {}), 30_000)
        })
        .catch(() => setState(mkState(false)))
    } else {
      // already initialized (StrictMode remount) — just reflect current state
      setState(mkState(!!keycloak.authenticated))
    }
    return () => { if (refreshTimer) clearInterval(refreshTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

/** Gate app routes: trigger login if unauthenticated. The public landing is NOT wrapped. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const triedLogin = useRef(false)
  useEffect(() => {
    if (auth.ready && !auth.authenticated && !triedLogin.current) {
      triedLogin.current = true
      auth.login()
    }
  }, [auth])
  if (!auth.ready || !auth.authenticated) return null
  return <>{children}</>
}
