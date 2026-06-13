import type { EventEnvelope } from '@sim/outbox-ts';

export interface ArtifactDocument {
  canonical_url: string;
  version: string;
  artifact_type: string;
  tenant_id: string;
  title?: string | undefined;
}

export interface OSIndexClient {
  index(doc: ArtifactDocument): Promise<void>;
}

/**
 * Consumes sim.artifact events and updates the OpenSearch artifact index.
 * In Phase 1, inject a no-op client; in production, inject the real
 * @opensearch-project/opensearch wrapper.
 */
export class OpenSearchIndexer {
  constructor(private readonly client: OSIndexClient) {}

  async handleEvent(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload;

    const canonical_url =
      typeof payload['canonical_url'] === 'string'
        ? payload['canonical_url']
        : undefined;
    const version =
      typeof payload['version'] === 'string' ? payload['version'] : undefined;
    const artifact_type =
      typeof payload['artifact_type'] === 'string'
        ? payload['artifact_type']
        : undefined;
    const rawTitle = payload['title'];
    const title =
      typeof rawTitle === 'string' ? rawTitle : undefined;

    if (!canonical_url || !version || !artifact_type) {
      // Missing required fields — skip silently
      return;
    }

    const doc: ArtifactDocument = {
      canonical_url,
      version,
      artifact_type,
      tenant_id: envelope.tenant.tenant_id,
      ...(title !== undefined ? { title } : {}),
    };

    await this.client.index(doc);
  }
}
