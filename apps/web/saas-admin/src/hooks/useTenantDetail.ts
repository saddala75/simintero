import { useState, useEffect } from 'react';
import type { Tenant, Entitlement } from '../api/controlPlaneClient.js';
import { controlPlaneClient } from '../api/controlPlaneClient.js';

interface UseTenantDetailResult {
  tenant: Tenant | null;
  entitlements: Entitlement[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTenantDetail(tenantId: string): UseTenantDetailResult {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      controlPlaneClient.getTenant(tenantId),
      controlPlaneClient.getEntitlements(tenantId),
    ])
      .then(([t, ents]) => {
        if (!cancelled) {
          setTenant(t);
          setEntitlements(ents);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tenant');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, tick]);

  function refetch() {
    setTick((t) => t + 1);
  }

  return { tenant, entitlements, loading, error, refetch };
}
