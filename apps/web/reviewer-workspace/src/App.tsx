import { useState } from 'react';
import { SimCtxProvider, useSimCtx } from './api/context.js';
import { Worklist } from './pages/Worklist.js';
import { CaseReview } from './pages/CaseReview.js';

type Route =
  | { name: 'worklist' }
  | { name: 'case-review'; caseId: string };

function AppShell() {
  const ctx = useSimCtx();
  const [route, setRoute] = useState<Route>({ name: 'worklist' });

  if (route.name === 'case-review') {
    return (
      <main>
        <nav style={{ padding: '8px 0', borderBottom: '1px solid #e5e7eb', marginBottom: '16px' }}>
          <button onClick={() => setRoute({ name: 'worklist' })}>← Back to Worklist</button>
          <span style={{ marginLeft: '16px', color: '#6b7280', fontSize: '0.875rem' }}>
            Tenant: {ctx.tenant_id}
          </span>
        </nav>
        <CaseReview caseId={route.caseId} roles={ctx.roles as string[]} />
      </main>
    );
  }

  return (
    <main>
      <Worklist onSelectCase={(caseId) => setRoute({ name: 'case-review', caseId })} />
    </main>
  );
}

export function App() {
  return (
    <SimCtxProvider>
      <AppShell />
    </SimCtxProvider>
  );
}
