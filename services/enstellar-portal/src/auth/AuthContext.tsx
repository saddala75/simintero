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
  login: (redirectUri?: string) => void
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
      login: () => {}, logout: () => {}, // ponytail: no-op in mock
    }
  }
  const t = keycloak.tokenParsed as Record<string, any> | undefined
  return {
    ready: true,
    authenticated: authd,
    roles: (t?.realm_access?.roles as string[]) ?? (t?.roles as string[]) ?? [],
    sub: t?.sub ?? '',
    tenantId: t?.tenant_id ?? '',
    displayName: t?.name ?? t?.preferred_username ?? '',
    login: (redirectUri?: string) => keycloak.login(redirectUri ? { redirectUri } : undefined),
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
          checkLoginIframe: false,
          silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        })
        .then((authd) => {
          setState(mkState(authd))
          if (authd) refreshTimer = setInterval(() => keycloak.updateToken(60).catch(() => {}), 30_000)
        })
        .catch(() => setState(mkState(false)))
    }
    // StrictMode remount: skip — the first init().then() will fire and set state correctly.
    // Do NOT call setState here: setting ready:true with authenticated:false before init
    // resolves causes ProtectedRoute to trigger a login redirect loop.
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
      // Pass current URL so KC redirects back to the page the user wanted
      auth.login(window.location.href)
    }
  }, [auth])
  if (!auth.ready || !auth.authenticated) return null
  return <>{children}</>
}
