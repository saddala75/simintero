import { useState } from 'react';
import TenantSearch from './pages/TenantSearch.js';
import ImpersonationSession from './pages/ImpersonationSession.js';
import CaseTimeline from './pages/CaseTimeline.js';
import DiagnosticBundleExport from './pages/DiagnosticBundleExport.js';

function App() {
  const [activeCaseId, setActiveCaseId] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [view, setView] = useState<'search' | 'session' | 'timeline' | 'export'>('search');

  return (
    <div>
      <h1>Support Console</h1>
      <nav style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setView('search')}>Tenant Search</button>
        <button onClick={() => setView('session')}>Impersonation</button>
        <button onClick={() => setView('timeline')}>Case Timeline</button>
        <button onClick={() => setView('export')}>Diagnostic Export</button>
      </nav>

      {(view === 'timeline' || view === 'export') && (
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
          <label>
            Case ID:
            <input
              type="text"
              value={activeCaseId}
              onChange={(e) => setActiveCaseId(e.target.value)}
              placeholder="case_001"
              style={{ marginLeft: '4px' }}
            />
          </label>
          {view === 'timeline' && (
            <label>
              Session Token:
              <input
                type="text"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                placeholder="tok_..."
                style={{ marginLeft: '4px' }}
              />
            </label>
          )}
        </div>
      )}

      {view === 'search' && <TenantSearch />}
      {view === 'session' && <ImpersonationSession />}
      {view === 'timeline' && activeCaseId && (
        <CaseTimeline caseId={activeCaseId} sessionToken={sessionToken} />
      )}
      {view === 'export' && activeCaseId && (
        <DiagnosticBundleExport caseId={activeCaseId} />
      )}
    </div>
  );
}

export default App;
