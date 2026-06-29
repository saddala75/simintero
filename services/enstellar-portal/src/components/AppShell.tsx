import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { RegulatoryCountdownBanner } from './RegulatoryCountdownBanner'

const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—'

function NavItem({
  icon, label, to, active, external,
}: {
  icon: string; label: string; to: string; active?: boolean; external?: boolean
}) {
  const cls = `flex items-center gap-3 px-4 py-2.5 rounded-lg no-underline transition-colors duration-150 text-sm ${
    active
      ? 'bg-[#001a42] text-[#3980f4] font-semibold'
      : 'text-[#45464d] hover:bg-[#e6e8ea]'
  }`
  if (external) {
    return (
      <a href={to} className={cls} target="_blank" rel="noreferrer noopener">
        <span className="material-symbols-outlined text-xl leading-none">{icon}</span>
        <span>{label}</span>
      </a>
    )
  }
  return (
    <Link to={to} className={cls}>
      <span className="material-symbols-outlined text-xl leading-none">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-4 mb-1.5 text-[10px] font-mono font-semibold text-[#45464d] uppercase tracking-widest">
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

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
  const { pathname } = useLocation()

  const is = (prefix: string) => pathname.startsWith(prefix)

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fb]">
      {/* ── Left sidebar ───────────────────────────────────────────── */}
      <aside className="fixed left-0 top-0 h-full w-64 flex flex-col z-40 bg-white border-r border-[#c6c6cd] overflow-y-auto">
        <div className="px-6 py-5 mb-2">
          <h1 className="text-base font-bold text-[#131b2e] tracking-tight">Simintero OS</h1>
          <p className="text-xs text-[#7c839b] mt-0.5">Healthcare Payer Platform</p>
        </div>

        <nav className="flex-1 px-2 space-y-5">
          <NavSection title="Utilization Mgmt">
            <NavItem icon="clinical_notes"          label="Review queue"        to="/queues/default/worklist" active={is('/queues') || is('/worklist') || is('/cases')} />
            <NavItem icon="settings_input_component" label="Intake & channels"   to="/intake"                 active={is('/intake')} />
            <NavItem icon="schedule"                label="Regulatory clocks"   to="/regulatory-clocks"      active={is('/regulatory-clocks')} />
          </NavSection>

          <NavSection title="Intelligence">
            <NavItem icon="psychology"   label="AI review · Revital"        to="/revital"   active={is('/revital')} />
            <NavItem icon="architecture" label="Policy studio · Digicore"   to="/digicore"  active={is('/digicore')} />
            <NavItem icon="fact_check"   label="Quality & gaps · Qualitron" to="/qualitron" active={is('/qualitron')} />
            <NavItem icon="monitoring"   label="Analytics"                  to="/analytics" active={is('/analytics')} />
            <NavItem icon="smart_toy"    label="AI Ops console"             to="/ai-ops"    active={is('/ai-ops')} />
          </NavSection>

          <NavSection title="Governance">
            <NavItem icon="gavel"        label="Determinations & appeals" to="/appeals"    active={is('/appeals')} />
            <NavItem icon="description"  label="Governance Reports"       to="/reports"    active={is('/reports')} />
            <NavItem icon="admin_panel_settings" label="SaaS Admin & IAM" to="/saas-admin" active={is('/saas-admin')} />
            <NavItem icon="support_agent" label="Support Impersonation"  to="/support"    active={is('/support')} />
            <NavItem icon="history_edu"  label="EHR simulator"            to="/ehr-sim"    active={is('/ehr-sim')} />
          </NavSection>
        </nav>

        <div className="mt-auto px-4 py-4 border-t border-[#c6c6cd]">
          <div className="px-3 py-2 bg-[#eceef0] rounded-lg mb-3">
            <span className="text-[11px] font-mono font-bold text-[#006c49] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#006c49] animate-pulse" />
              {auth.tenantId ? auth.tenantId.toUpperCase() : 'SIMINTERO'}
            </span>
          </div>
          <div className="flex items-center gap-2 px-1">
            <span className="w-7 h-7 rounded-full bg-[#006c49] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
              {initials(auth.displayName || 'Reviewer')}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#191c1e] truncate">{auth.displayName || 'Reviewer'}</p>
              <button
                onClick={auth.logout}
                className="text-[10px] text-[#45464d] hover:text-[#191c1e] transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main column ────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 ml-64 min-w-0">
        <RegulatoryCountdownBanner />
        <header className="h-14 bg-white border-b border-[#c6c6cd] px-6 flex items-center justify-between z-30 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {breadcrumb
              ? <span className="text-xs font-mono text-[#45464d]">{breadcrumb}</span>
              : <span className="text-sm font-medium text-[#191c1e]">Enstellar</span>}
          </div>
          <span className="text-xs text-[#45464d] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#3980f4]" />
            Governed AI · Active
          </span>
        </header>
        {noScroll
          ? <div className="flex-1 overflow-hidden">{children}</div>
          : <div className="flex-1 overflow-y-auto">{children}</div>}
      </div>
    </div>
  )
}
