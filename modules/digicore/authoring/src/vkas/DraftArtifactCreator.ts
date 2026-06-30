export class DuplicateArtifactError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DuplicateArtifactError';
  }
}

export interface VkasHttpClient {
  post(url: string, body: unknown): Promise<{ artifact_id: string; version: string }>;
}

export interface DraftArtifactInput {
  artifact_type: 'cql_library' | 'coverage_rule';
  canonical_url: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface DraftResult {
  artifact_id: string;
  version: string;
}

export class DraftArtifactCreator {
  private readonly httpClient: VkasHttpClient;
  private readonly vkasBaseUrl: string;

  constructor(httpClient: VkasHttpClient, vkasBaseUrl: string) {
    this.httpClient = httpClient;
    this.vkasBaseUrl = vkasBaseUrl;
  }

  async createDraft(artifact: DraftArtifactInput): Promise<DraftResult> {
    return this.httpClient.post(`${this.vkasBaseUrl}/v1/artifacts`, artifact);
  }
}
