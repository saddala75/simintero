import { describe, it, expect } from 'vitest';
import { applyPhiFilter } from '../PhiFilter.js';

describe('PhiFilter', () => {
  it('strips fields not in the allow-list for the task_kind', () => {
    const result = applyPhiFilter('summarize', {
      document_span_refs: ['doc_77#p4'],
      member_name: 'John Doe',      // NOT in allow-list for summarize
      section_labels: ['History'],
    });
    expect(result).toEqual({
      document_span_refs: ['doc_77#p4'],
      section_labels: ['History'],
    });
    expect('member_name' in result).toBe(false);
  });

  it('redacts SSN pattern in allowed string fields', () => {
    const result = applyPhiFilter('extract_entities', {
      document_span_refs: [],
      text_segments: ['SSN 123-45-6789 noted in chart'],
      entity_schema_ref: 'schema:v1',
      clinical_context: {},
    });
    expect((result['text_segments'] as string[])[0]).toContain('[REDACTED]');
    expect((result['text_segments'] as string[])[0]).not.toContain('123-45-6789');
  });

  it('redacts MRN pattern in allowed string fields', () => {
    const result = applyPhiFilter('extract_entities', {
      document_span_refs: [],
      text_segments: ['MRN: 0045891 presented with knee pain'],
      entity_schema_ref: 'schema:v1',
      clinical_context: {},
    });
    expect((result['text_segments'] as string[])[0]).toContain('[REDACTED]');
  });

  it('throws on unknown task_kind', () => {
    expect(() => applyPhiFilter('unknown_task', {})).toThrow('Unknown task_kind');
  });

  it('preserves non-string fields (arrays, objects) in allowed keys', () => {
    const spanRefs = ['doc_1#p1', 'doc_1#p2'];
    const result = applyPhiFilter('summarize', {
      document_span_refs: spanRefs,
      section_labels: ['Chief Complaint'],
    });
    expect(result['document_span_refs']).toEqual(spanRefs);
  });
});
