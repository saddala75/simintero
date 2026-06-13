import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { ArtifactSearchService } from '../search/ArtifactSearchService.js';
import type { OSClient, OSSearchResult } from '../search/ArtifactSearchService.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['DIG'] },
  roles: [],
  principal_type: 'service' as const,
};

const MOCK_ARTIFACT = {
  canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
  version: '1.0.0',
  artifact_type: 'coverage_rule',
  tenant_id: 't_test',
  title: 'Knee Arthroscopy Coverage Rule',
};

describe('ArtifactSearchService', () => {
  it('search returns correct artifacts for lob+service_category', async () => {
    const mockResult: OSSearchResult = {
      items: [MOCK_ARTIFACT],
      total: 1,
    };

    const mockOsClient: OSClient = {
      search: vi.fn().mockResolvedValue(mockResult),
    };

    const service = new ArtifactSearchService(mockOsClient);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      service.search({
        artifact_type: 'coverage_rule',
        lob: 'MA',
        service_category: 'knee_arthroscopy',
      })
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
      artifact_type: 'coverage_rule',
    });

    expect(mockOsClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_type: 'coverage_rule',
        lob: 'MA',
        service_category: 'knee_arthroscopy',
        tenant_id: 't_test',
      })
    );
  });

  it('passes tenant_id from ctx() into every search call', async () => {
    const mockResult: OSSearchResult = { items: [], total: 0 };
    const mockOsClient: OSClient = {
      search: vi.fn().mockResolvedValue(mockResult),
    };

    const service = new ArtifactSearchService(mockOsClient);

    const otherCtx = { ...TEST_CONTEXT, tenant_id: 't_other' };

    await withTenantContext(otherCtx, () => service.search({}));

    expect(mockOsClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't_other' })
    );
  });

  it('throws when called outside tenant context', async () => {
    const mockOsClient: OSClient = {
      search: vi.fn(),
    };

    const service = new ArtifactSearchService(mockOsClient);

    await expect(service.search({ artifact_type: 'coverage_rule' })).rejects.toThrow(
      'No tenant context'
    );
  });
});
