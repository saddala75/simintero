import { ctx } from '@sim/tenant-context-ts';

export interface ArtifactQuery {
  artifact_type?: string | undefined;
  lob?: string | undefined;
  service_category?: string | undefined;
  program?: string | undefined;
  product?: string | undefined;
}

export interface OSSearchQuery extends ArtifactQuery {
  tenant_id: string;
}

export interface ArtifactSummary {
  canonical_url: string;
  version: string;
  artifact_type: string;
  tenant_id: string;
  title?: string | undefined;
}

export interface OSSearchResult {
  items: ArtifactSummary[];
  total: number;
}

export interface OSClient {
  search(query: OSSearchQuery): Promise<OSSearchResult>;
}

export class ArtifactSearchService {
  constructor(private readonly osClient: OSClient) {}

  async search(query: ArtifactQuery): Promise<OSSearchResult> {
    const context = ctx();
    return this.osClient.search({ ...query, tenant_id: context.tenant_id });
  }
}
