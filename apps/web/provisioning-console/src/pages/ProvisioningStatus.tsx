import { useState, useEffect, useRef } from 'react';
import type { ProvisioningOperation } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';
import { ProvisioningTimeline } from '../components/ProvisioningTimeline.js';

interface Props {
  operationId: string;
}

export function ProvisioningStatus({ operationId }: Props) {
  const [operation, setOperation] = useState<ProvisioningOperation | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const op = await controlPlaneClient.getOperation(operationId);
        if (!active) return;
        setOperation(op);
        if (op.status === 'completed' || op.status === 'failed') {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        // keep polling on transient errors
      }
    };

    void poll();
    intervalRef.current = setInterval(() => { void poll(); }, 2000);

    return () => {
      active = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [operationId]);

  if (!operation) {
    return <div>Loading…</div>;
  }

  return (
    <div>
      <h2>Provisioning Status</h2>

      <dl>
        <dt>Operation ID</dt>
        <dd>{operation.operation_id}</dd>

        <dt>Status</dt>
        <dd>
          <span data-testid="operation-status">{operation.status}</span>
        </dd>

        <dt>Created</dt>
        <dd>{operation.created_at}</dd>
      </dl>

      <ProvisioningTimeline status={operation.status} />
    </div>
  );
}
