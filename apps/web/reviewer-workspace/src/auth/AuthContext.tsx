import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { keycloak, IS_MOCK } from './keycloak'

let initStarted = false

export interface AuthState {
  ready: boolean
  authenticated: boolean
  sub: string
  login: () => void
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

function mkState(authd: boolean): AuthState {
  if (IS_MOCK) {
    return { ready: true, authenticated: true, sub: 'mock-sub', login: () => {}, logout: () => {} }
  }
  const t = keycloak.tokenParsed as Record<string, unknown> | undefined
  return {
    ready: true,
    authenticated: authd,
    sub: (t?.sub as string) ?? '',
    login: () => keycloak.login(),
    logout: () => keycloak.logout({ redirectUri: window.location.origin }),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    IS_MOCK ? mkState(true) : { ...mkState(false), ready: false }
  )

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
    } else {
      setState(mkState(!!keycloak.authenticated))
    }
    return () => { if (refreshTimer) clearInterval(refreshTimer) }
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function RequireAuth({ children }: { children: ReactNode }) {
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
