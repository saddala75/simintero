import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { RegulatoryCountdownBanner } from './RegulatoryCountdownBanner'

const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—'

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
    <div className="en-app flex flex-col h-screen overflow-hidden bg-[#F7F9FB]">
      <RegulatoryCountdownBanner />
      <div className="en-topbar bg-[#000000] text-white h-14 px-4 flex items-center justify-between z-30 shadow-md">
        <div className="flex items-center gap-6">
          <Link to="/" className="en-brand flex items-center gap-2 font-bold text-lg text-white no-underline">
            <svg className="mark w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="6" stroke="#3980F4" strokeWidth="2" />
              <circle cx="12" cy="12" r="3.5" fill="#006C49" />
            </svg>
            <span className="tracking-tight">Enstellar</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm font-medium ml-4">
            <Link to="/worklist" className="text-slate-300 hover:text-white transition-colors no-underline">
              Prior Auth Cases
            </Link>
            <Link to="/appeals" className="text-slate-300 hover:text-white transition-colors no-underline">
              Appeals & Grievances
            </Link>
          </nav>
          {breadcrumb ? <span className="en-breadcrumb text-slate-400 text-xs font-mono">{breadcrumb}</span> : null}
        </div>

        <div className="en-topright flex items-center gap-4">
          <span className="en-env font-mono text-[10px] bg-slate-800 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full uppercase">
            TENANT · {auth.tenantId ? auth.tenantId.toUpperCase() : 'SIMINTERO'}
          </span>
          <span className="en-ai-global text-xs text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#3980F4]" />
            Governed AI · Active
          </span>
          <span className="en-avatar w-8 h-8 rounded-full bg-[#006C49] text-white font-bold text-xs flex items-center justify-center border border-emerald-400" title={auth.displayName || 'Reviewer'}>
            {initials(auth.displayName || 'Reviewer')}
          </span>
        </div>
      </div>
      {noScroll ? children : <div className="en-scroll flex-1 overflow-y-auto">{children}</div>}
    </div>
  )
}
