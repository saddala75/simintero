import { type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'

const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—'

/** App chrome: dark topbar + scroll area (or raw children when noScroll=true). */
export function AppShell({
  breadcrumb,
  children,
  noScroll,
}: {
  breadcrumb?: ReactNode
  children: ReactNode
  noScroll?: boolean
}) {
  const auth = useAuth()
  return (
    <div className="en-app">
      <div className="en-topbar">
        <span className="en-brand">
          <svg className="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="6" stroke="#74DBC8" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="3.4" fill="#74DBC8" />
          </svg>
          Enstellar
        </span>
        {breadcrumb ? <span className="en-breadcrumb">{breadcrumb}</span> : null}
        <div className="en-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Search cases, members, providers…
        </div>
        <div className="en-topright">
          <span className="en-env">TENANT · {auth.tenantId ? auth.tenantId.toUpperCase() : '—'}</span>
          <span className="en-ai-global"><span className="dot" />Governed AI · on</span>
          <span className="en-avatar" title={auth.displayName || 'Reviewer'}>{initials(auth.displayName)}</span>
        </div>
      </div>
      {noScroll ? children : <div className="en-scroll">{children}</div>}
    </div>
  )
}
