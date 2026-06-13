import { useState } from 'react';
import type { Tenant } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';

interface Props {
  tenant: Tenant;
  onSuccess?: () => void;
}

type ActionKind = 'suspend' | 'archive' | null;

export function LifecycleActions({ tenant, onSuccess }: Props) {
  const [pendingAction, setPendingAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isDecommissioned = tenant.status === 'decommissioned';
  const isSuspendDisabled = isDecommissioned || tenant.status === 'suspended';
  const isArchiveDisabled = isDecommissioned || tenant.status === 'archived';

  function openModal(action: 'suspend' | 'archive') {
    setReason('');
    setPendingAction(action);
  }

  function closeModal() {
    setPendingAction(null);
    setReason('');
  }

  async function handleConfirm() {
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      if (pendingAction === 'suspend') {
        await controlPlaneClient.suspendTenant(tenant.tenant_id, reason);
      } else {
        await controlPlaneClient.archiveTenant(tenant.tenant_id, reason);
      }
      closeModal();
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="lifecycle-actions">
      <button
        onClick={() => openModal('suspend')}
        disabled={isSuspendDisabled}
        aria-label="Suspend tenant"
        data-testid="btn-suspend"
      >
        Suspend
      </button>
      <button
        onClick={() => openModal('archive')}
        disabled={isArchiveDisabled}
        aria-label="Archive tenant"
        data-testid="btn-archive"
        style={{ marginLeft: '8px' }}
      >
        Archive
      </button>

      {pendingAction !== null && (
        <div role="dialog" aria-modal="true" data-testid="lifecycle-modal">
          <h2>
            Confirm {pendingAction === 'suspend' ? 'Suspend' : 'Archive'}
          </h2>
          <label htmlFor="lifecycle-reason">Reason</label>
          <textarea
            id="lifecycle-reason"
            data-testid="reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason..."
          />
          <div>
            <button onClick={closeModal} data-testid="btn-cancel">
              Cancel
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={submitting}
              data-testid="btn-confirm"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
