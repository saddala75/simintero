import { AppShell } from '../components/AppShell'

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <AppShell breadcrumb={title}>
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: '0 24px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#c6c6cd' }}>
          construction
        </span>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#131b2e', marginTop: 16 }}>{title}</h2>
        <p style={{ color: '#7c839b', marginTop: 8, fontSize: 14 }}>
          This module is being integrated. Check back soon.
        </p>
      </div>
    </AppShell>
  )
}
