import { useState } from 'react';
import { SimCtxProvider, useSimCtx } from './api/context.js';
import { Worklist } from './pages/Worklist.js';
import { CaseReview } from './pages/CaseReview.js';
import { DeterminationView } from './pages/DeterminationView.js';

type Route =
  | { name: 'worklist' }
  | { name: 'case-review'; caseId: string }
  | { name: 'determination'; caseId: string };

function Topbar({ route, onHome }: { route: Route; onHome: () => void }) {
  const ctx = useSimCtx();
  const tenantLabel = ctx.tenant_id.replace(/^t_/, '').replace(/_/g, ' ').toUpperCase();
  const isMD = (ctx.roles as string[]).includes('medical_director');

  const segLabel =
    route.name === 'worklist' ? 'Utilization Management' :
    route.name === 'determination' ? 'Determination' :
    'Clinical Review';

  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} title="Utilization Management home">
        <svg style={{ width: 22, height: 22 }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="6" stroke="#74DBC8" strokeWidth="1.6"/>
          <circle cx="12" cy="12" r="3.4" fill="#74DBC8"/>
        </svg>
        Enstellar
      </button>
      <span className="topbar-seg">
        <b>{segLabel}</b>
      </span>
      <div className="topbar-search" role="search" aria-label="Search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Search cases, members, providers…
      </div>
      <div className="topbar-right">
        <span className="env-chip">TENANT · {tenantLabel}</span>
        <span className="ai-status">
          <span className="dot" aria-hidden="true" />
          Governed AI · on
        </span>
        <span className="avatar" title={isMD ? 'Medical Director' : 'Reviewer'}>
          {isMD ? 'MD' : 'RN'}
        </span>
      </div>
    </header>
  );
}

function AppShell() {
  const ctx = useSimCtx();
  const [route, setRoute] = useState<Route>({ name: 'worklist' });

  const roles = ctx.roles as string[];
  const handleHome = () => setRoute({ name: 'worklist' });

  return (
    <div className="app">
      <Topbar route={route} onHome={handleHome} />

      {route.name === 'worklist' && (
        <Worklist
          onSelectCase={(caseId) => setRoute({ name: 'case-review', caseId })}
          onMdDetermination={(caseId) => setRoute({ name: 'determination', caseId })}
        />
      )}

      {route.name === 'case-review' && (
        <CaseReview
          caseId={route.caseId}
          roles={roles}
          onBack={handleHome}
          onSelectCase={(caseId) => setRoute({ name: 'case-review', caseId })}
          onDetermination={(caseId) => setRoute({ name: 'determination', caseId })}
        />
      )}

      {route.name === 'determination' && (
        <DeterminationView
          caseId={route.caseId}
          onBack={() => setRoute({ name: 'case-review', caseId: route.caseId })}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <SimCtxProvider>
      <AppShell />
    </SimCtxProvider>
  );
}
