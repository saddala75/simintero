import type { DocMeta } from './fetchDocuments.js';

export interface Span {
  page: number;
  region: [number, number, number, number];
  text: string;
  hash: string;
}

export type SpanMap = Record<string, Span[]>;

export async function parseSegmentImpl(
  docs: DocMeta[],
  docServiceUrl: string,
  tenantId: string,
): Promise<SpanMap> {
  const spanMap: SpanMap = {};

  for (const doc of docs) {
    try {
      const res = await fetch(`${docServiceUrl}/documents/${doc.doc_id}/spans`, {
        headers: { 'x-sim-tenant-id': tenantId },
      });
      if (!res.ok) { spanMap[doc.doc_id] = []; continue; }
      const body = (await res.json()) as {
        doc_id: string;
        spans: Array<{
          seq: number;
          page: number;
          region: [number, number, number, number];
          text: string;
          excerpt_hash: string;
        }>;
      };
      spanMap[doc.doc_id] = (body.spans ?? []).map((s) => ({
        page: s.page,
        region: s.region,
        text: s.text,
        hash: s.excerpt_hash,
      }));
    } catch {
      spanMap[doc.doc_id] = [];
    }
  }
  return spanMap;
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070';

export async function parseSegment(docs: DocMeta[], tenantId: string): Promise<SpanMap> {
  return parseSegmentImpl(docs, DOC_SERVICE_URL, tenantId);
}
