import type { Pool } from 'pg';

export interface IndexDocument {
  entity_type: 'case' | 'document' | 'gap' | 'measure_report';
  entity_id: string;
  tenant_id: string;
  content_hash: string;  // SHA-256 of sanitized content — no raw PHI
  metadata: Record<string, string>;  // structured metadata only, no free-text PHI
  indexed_at: string;
}

export interface IndexClient {
  upsert(doc: IndexDocument): Promise<void>;
}

// Real implementation wrapping @opensearch-project/opensearch
// For unit tests, inject a stub implementation instead
export class OpenSearchIndexClient implements IndexClient {
  constructor(private readonly indexName: string) {}
  async upsert(_doc: IndexDocument): Promise<void> {
    // Real implementation would call opensearch client
    // Stubbed here — integration configured at service startup
    throw new Error('OpenSearchIndexClient not configured — inject a stub in tests');
  }
}
