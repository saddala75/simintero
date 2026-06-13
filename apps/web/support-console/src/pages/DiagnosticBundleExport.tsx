import { useState } from 'react';
import { supportConsoleClient } from '../api/supportConsoleClient.js';

interface Props {
  caseId: string;
}

export default function DiagnosticBundleExport({ caseId }: Props) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    const result = await supportConsoleClient.requestDiagnosticBundle(caseId);
    setOperationId(result.operation_id);
    setLoading(false);
  };

  return (
    <div>
      <button onClick={handleExport} disabled={loading}>
        {loading ? 'Requesting...' : 'Request Export'}
      </button>
      {operationId && <p>Export requested. Operation ID: {operationId}</p>}
    </div>
  );
}
