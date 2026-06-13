import { useState } from 'react';
import { Worklist } from './pages/Worklist.js';
import { CaseReview } from './pages/CaseReview.js';

// Minimal in-app routing — no router dependency needed for Phase 1
type Route =
  | { name: 'worklist' }
  | { name: 'case-review'; caseId: string };

// Demo roles — in production these come from auth context
const DEMO_ROLES = ['medical_director'];

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'worklist' });

  if (route.name === 'case-review') {
    return (
      <main>
        <button onClick={() => setRoute({ name: 'worklist' })}>← Back to Worklist</button>
        <CaseReview caseId={route.caseId} roles={DEMO_ROLES} />
      </main>
    );
  }

  return (
    <main>
      <Worklist />
    </main>
  );
}
