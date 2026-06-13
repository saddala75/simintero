import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';

// vi.mock is hoisted before imports by vitest
vi.mock('@sim/authz-client-ts', () => ({
  authorize: vi.fn(),
}));

import { authorize } from '@sim/authz-client-ts';
import { recordDecision } from '../mutations/recordDecision.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['medical_director'],
  principal_type: 'human' as const,
};

const BASE_INPUT = {
  caseId: 'case-uuid-001',
  outcome: 'denied',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('recordDecision mutation', () => {
  describe('authorization failure (SIM-AUTHZ-0001)', () => {
    it('returns 403 payload when authorize throws SIM-AUTHZ-0001', async () => {
      vi.mocked(authorize).mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), {
          code: 'SIM-AUTHZ-0001',
          status: 403,
        })
      );

      // No tenant context needed — authorize is mocked and we return before ctx()
      const result = await recordDecision(BASE_INPUT);

      expect(result.error).toBe('Forbidden: medical director role required');
      expect(result.errorCode).toBe('403');
      expect(result.determinationId).toBeNull();
    });

    it('does not call fetch (case-service) when authorize is denied', async () => {
      vi.mocked(authorize).mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { code: 'SIM-AUTHZ-0001', status: 403 })
      );

      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      await recordDecision(BASE_INPUT);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('re-throws non-authz errors from authorize', async () => {
      const networkErr = new Error('OPA unreachable');
      vi.mocked(authorize).mockRejectedValueOnce(networkErr);

      await expect(
        withTenantContext(TEST_CONTEXT, () => recordDecision(BASE_INPUT))
      ).rejects.toThrow('OPA unreachable');
    });
  });

  describe('authorization success', () => {
    it('returns determinationId on successful case-service response', async () => {
      vi.mocked(authorize).mockResolvedValueOnce(undefined);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ determinationId: 'det-new-001' }),
        })
      );

      const result = await withTenantContext(TEST_CONTEXT, () =>
        recordDecision(BASE_INPUT)
      );

      expect(result.determinationId).toBe('det-new-001');
      expect(result.error).toBeNull();
      expect(result.errorCode).toBeNull();
    });

    it('forwards x-tenant-id header from ctx() to case-service', async () => {
      vi.mocked(authorize).mockResolvedValueOnce(undefined);

      const fetchSpy = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ determinationId: 'det-002' }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      await withTenantContext(TEST_CONTEXT, () => recordDecision(BASE_INPUT));

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['x-tenant-id']).toBe('t_test');
    });

    it('returns stub payload when case-service returns 501', async () => {
      vi.mocked(authorize).mockResolvedValueOnce(undefined);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 501,
        })
      );

      const result = await withTenantContext(TEST_CONTEXT, () =>
        recordDecision(BASE_INPUT)
      );

      expect(result.determinationId).toBe('stub-det-id');
      expect(result.error).toBeNull();
    });

    it('returns error payload when case-service returns non-ok status', async () => {
      vi.mocked(authorize).mockResolvedValueOnce(undefined);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 500,
        })
      );

      const result = await withTenantContext(TEST_CONTEXT, () =>
        recordDecision(BASE_INPUT)
      );

      expect(result.determinationId).toBeNull();
      expect(result.error).toBe('Case service error');
      expect(result.errorCode).toBe('500');
    });

    it('returns 503 payload when case-service is unreachable (fetch throws)', async () => {
      vi.mocked(authorize).mockResolvedValueOnce(undefined);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'))
      );

      const result = await withTenantContext(TEST_CONTEXT, () =>
        recordDecision(BASE_INPUT)
      );

      expect(result.determinationId).toBeNull();
      expect(result.error).toBe('Case service unreachable');
      expect(result.errorCode).toBe('503');
    });
  });
});
