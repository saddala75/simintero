import { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { RegulatoryCountdownBanner } from './RegulatoryCountdownBanner'

const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—'

function NavItem({
  icon, label, to, active, external, collapsed,
}: {
  icon: string; label: string; to: string; active?: boolean; external?: boolean; collapsed?: boolean
}) {
  const cls = `flex items-center gap-3 px-3 py-2.5 rounded-lg no-underline transition-colors duration-150 text-sm ${
    collapsed ? 'justify-center px-0' : ''
  } ${
    active
      ? 'bg-[#001a42] text-[#3980f4] font-semibold'
      : 'text-[#45464d] hover:bg-[#e6e8ea]'
  }`
  const content = (
    <>
      <span className="material-symbols-outlined text-xl leading-none shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </>
  )
  if (external) {
    return (
      <a href={to} className={cls} target="_blank" rel="noreferrer noopener" title={collapsed ? label : undefined}>
        {content}
      </a>
    )
  }
  return (
    <Link to={to} className={cls} title={collapsed ? label : undefined}>
      {content}
    </Link>
  )
}

function NavSection({ title, children, collapsed }: { title: string; children: ReactNode; collapsed?: boolean }) {
  if (collapsed) return <div className="space-y-0.5">{children}</div>
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
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('nav-collapsed') === '1' } catch { return false }
  })

  const toggle = () => setCollapsed((c) => {
    const next = !c
    try { localStorage.setItem('nav-collapsed', next ? '1' : '0') } catch {}
    return next
  })

  const is = (prefix: string) => pathname.startsWith(prefix)
  const sideW = collapsed ? 'w-16' : 'w-64'
  const mainML = collapsed ? 'ml-16' : 'ml-64'

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fb]">
      {/* ── Left sidebar ───────────────────────────────────────────── */}
      <aside className={`fixed left-0 top-0 h-full ${sideW} flex flex-col z-40 bg-white border-r border-[#c6c6cd] overflow-y-auto transition-all duration-200`}>
        <div className={`flex items-center ${collapsed ? 'justify-center px-0 py-5' : 'px-6 py-5'} mb-2`}>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-[#131b2e] tracking-tight">Simintero OS</h1>
              <p className="text-xs text-[#7c839b] mt-0.5">Healthcare Payer Platform</p>
            </div>
          )}
          <button
            onClick={toggle}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[#45464d] hover:bg-[#e6e8ea] transition-colors ${collapsed ? '' : 'ml-2'}`}
          >
            <span className="material-symbols-outlined text-base leading-none">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
        </div>

        <nav className={`flex-1 ${collapsed ? 'px-1' : 'px-2'} space-y-5`}>
          <NavItem icon="home" label="Dashboard" to="/dashboard" active={is('/dashboard')} collapsed={collapsed} />

          <NavSection title="Operations" collapsed={collapsed}>
            <NavItem icon="clinical_notes"           label="Review Queue"       to="/queues/default/worklist" active={is('/queues') || is('/worklist') || is('/cases')} collapsed={collapsed} />
            <NavItem icon="settings_input_component" label="Intake & Channels"  to="/intake"                  active={is('/intake')} collapsed={collapsed} />
            <NavItem icon="schedule"                 label="Regulatory Clocks"  to="/regulatory-clocks"       active={is('/regulatory-clocks')} collapsed={collapsed} />
            <NavItem icon="gavel"                    label="Appeals"            to="/appeals"                 active={is('/appeals')} collapsed={collapsed} />
            <NavItem icon="feedback"                 label="Grievances"         to="/grievances"              active={is('/grievances')} collapsed={collapsed} />
          </NavSection>

          <NavSection title="Consoles" collapsed={collapsed}>
            <NavItem icon="psychology"   label="Revital · AI Review"  to="/revital"   active={is('/revital')}   collapsed={collapsed} />
            <NavItem icon="architecture" label="Digicore · Policy"    to="/digicore"  active={is('/digicore')}  collapsed={collapsed} />
            <NavItem icon="fact_check"   label="Qualitron · Quality"  to="/qualitron" active={is('/qualitron')} collapsed={collapsed} />
            <NavItem icon="monitoring"   label="Analytics"            to="/analytics" active={is('/analytics')} collapsed={collapsed} />
          </NavSection>

          <NavSection title="Platform" collapsed={collapsed}>
            <NavItem icon="description"          label="Governance Reports"    to="/reports"    active={is('/reports')}    collapsed={collapsed} />
            <NavItem icon="smart_toy"            label="AI Ops"                to="/ai-ops"     active={is('/ai-ops')}     collapsed={collapsed} />
            <NavItem icon="admin_panel_settings" label="SaaS Admin & IAM"     to="/saas-admin" active={is('/saas-admin')} collapsed={collapsed} />
            <NavItem icon="support_agent"        label="Support"               to="/support"    active={is('/support')}    collapsed={collapsed} />
            <NavItem icon="terminal"             label="EHR Simulator"         to="/ehr-sim"    active={is('/ehr-sim')}    collapsed={collapsed} />
          </NavSection>
        </nav>

        <div className={`mt-auto ${collapsed ? 'px-1' : 'px-4'} py-4 border-t border-[#c6c6cd]`}>
          {!collapsed && (
            <div className="px-3 py-2 bg-[#eceef0] rounded-lg mb-3">
              <span className="text-[11px] font-mono font-bold text-[#006c49] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#006c49] animate-pulse" />
                {auth.tenantId ? auth.tenantId.toUpperCase() : 'SIMINTERO'}
              </span>
            </div>
          )}
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2 px-1'}`}>
            <span
              className="w-7 h-7 rounded-full bg-[#006c49] text-white text-[11px] font-bold flex items-center justify-center shrink-0"
              title={collapsed ? (auth.displayName || 'Reviewer') : undefined}
            >
              {initials(auth.displayName || 'Reviewer')}
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#191c1e] truncate">{auth.displayName || 'Reviewer'}</p>
                <button
                  onClick={auth.logout}
                  className="text-[10px] text-[#45464d] hover:text-[#191c1e] transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ────────────────────────────────────────────── */}
      <div className={`flex flex-col flex-1 ${mainML} min-w-0 transition-all duration-200`}>
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
