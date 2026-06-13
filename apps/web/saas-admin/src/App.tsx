import { useState } from 'react';
import { TenantList } from './pages/TenantList.js';
import { TenantDetail } from './pages/TenantDetail.js';
import { EnvGroupView } from './pages/EnvGroupView.js';
import { CellView } from './pages/CellView.js';

type Page = 'list' | 'detail' | 'env-groups' | 'cells';

export function App() {
  const [page, setPage] = useState<Page>('list');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  function navigate(p: Page, tenantId?: string) {
    setPage(p);
    if (tenantId) setSelectedTenantId(tenantId);
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '16px' }}>
      <nav style={{ marginBottom: '16px', display: 'flex', gap: '12px', borderBottom: '1px solid #e5e7eb', paddingBottom: '12px' }}>
        <button onClick={() => navigate('list')}>Tenants</button>
        <button onClick={() => navigate('env-groups')}>Env Groups</button>
        <button onClick={() => navigate('cells')}>Cells</button>
      </nav>

      {page === 'list' && (
        <TenantList onSelect={(id) => navigate('detail', id)} />
      )}
      {page === 'detail' && selectedTenantId && (
        <>
          <button onClick={() => navigate('list')} style={{ marginBottom: '12px' }}>
            &larr; Back to Tenants
          </button>
          <TenantDetail tenantId={selectedTenantId} />
        </>
      )}
      {page === 'env-groups' && <EnvGroupView />}
      {page === 'cells' && <CellView />}
    </div>
  );
}
