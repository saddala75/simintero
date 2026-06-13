export interface VkasHttpClient {
  post(url: string, body: unknown): Promise<{ artifact_id: string; version: string }>;
}

export interface DraftArtifactInput {
  artifact_type: 'cql_library';
  canonical_url: string;
  content: {
    cql: string;
    elm: unknown;
  };
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
