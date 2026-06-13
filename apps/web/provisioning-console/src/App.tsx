import { useState } from 'react';
import { NewTenantWizard } from './pages/NewTenant/index.js';
import { ProvisioningStatus } from './pages/ProvisioningStatus.js';

type AppPage =
  | { name: 'wizard' }
  | { name: 'status'; operationId: string };

function App() {
  const [page, setPage] = useState<AppPage>({ name: 'wizard' });

  if (page.name === 'status') {
    return <ProvisioningStatus operationId={page.operationId} />;
  }

  return (
    <NewTenantWizard
      onComplete={(operationId) => setPage({ name: 'status', operationId })}
    />
  );
}

export default App;
