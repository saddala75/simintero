import { useState } from 'react';
import type { Entitlement } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';

interface Props {
  tenantId: string;
  entitlements: Entitlement[];
  onSave?: (e: Entitlement) => void;
}

interface RowState {
  editing: boolean;
  editValue: string;
  saving: boolean;
}

export function EntitlementEditor({ tenantId, entitlements: initialEntitlements, onSave }: Props) {
  const [entitlements, setEntitlements] = useState<Entitlement[]>(initialEntitlements);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  function getRowState(key: string): RowState {
    return rowStates[key] ?? { editing: false, editValue: '', saving: false };
  }

  function startEdit(key: string, currentValue: unknown) {
    setRowStates((prev) => ({
      ...prev,
      [key]: {
        editing: true,
        editValue: typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue),
        saving: false,
      },
    }));
  }

  function cancelEdit(key: string) {
    setRowStates((prev) => ({
      ...prev,
      [key]: { ...getRowState(key), editing: false },
    }));
  }

  function setEditValue(key: string, val: string) {
    setRowStates((prev) => ({
      ...prev,
      [key]: { ...getRowState(key), editValue: val },
    }));
  }

  async function saveEdit(key: string) {
    const rs = getRowState(key);
    const originalEntitlement = entitlements.find((e) => e.key === key);
    if (!originalEntitlement) return;

    const newValue = rs.editValue;

    // Optimistic update
    setEntitlements((prev) =>
      prev.map((e) => (e.key === key ? { ...e, value: newValue } : e)),
    );
    setRowStates((prev) => ({
      ...prev,
      [key]: { editing: false, editValue: '', saving: true },
    }));

    try {
      const updated = await controlPlaneClient.patchEntitlement(
        tenantId,
        key,
        newValue,
        originalEntitlement.expires_at,
      );
      setEntitlements((prev) => prev.map((e) => (e.key === key ? updated : e)));
      setRowStates((prev) => ({ ...prev, [key]: { editing: false, editValue: '', saving: false } }));
      onSave?.(updated);
    } catch {
      // Rollback
      setEntitlements((prev) =>
        prev.map((e) => (e.key === key ? originalEntitlement : e)),
      );
      setRowStates((prev) => ({ ...prev, [key]: { editing: false, editValue: '', saving: false } }));
    }
  }

  return (
    <table data-testid="entitlement-table">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {entitlements.map((ent) => {
          const rs = getRowState(ent.key);
          return (
            <tr key={ent.key} data-testid={`entitlement-row-${ent.key}`}>
              <td>{ent.key}</td>
              <td>
                {rs.editing ? (
                  <input
                    aria-label={`Edit value for ${ent.key}`}
                    value={rs.editValue}
                    onChange={(ev) => setEditValue(ent.key, ev.target.value)}
                  />
                ) : (
                  <span data-testid={`value-${ent.key}`}>
                    {typeof ent.value === 'string' ? ent.value : JSON.stringify(ent.value)}
                  </span>
                )}
              </td>
              <td>{ent.expires_at ?? 'never'}</td>
              <td>
                {rs.editing ? (
                  <>
                    <button
                      onClick={() => void saveEdit(ent.key)}
                      disabled={rs.saving}
                      aria-label={`Save ${ent.key}`}
                    >
                      Save
                    </button>
                    <button onClick={() => cancelEdit(ent.key)} aria-label={`Cancel ${ent.key}`}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => startEdit(ent.key, ent.value)}
                    aria-label={`Edit ${ent.key}`}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
