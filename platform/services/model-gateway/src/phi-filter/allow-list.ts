// Normative from PLAT-model-gateway spec. Adding a key requires code review + security sign-off.
export const PHI_ALLOW_LIST: Record<string, string[]> = {
  extract_entities: [
    'document_span_refs',
    'text_segments',
    'entity_schema_ref',
    'clinical_context',
  ],
  summarize: [
    'document_span_refs',
    'section_labels',
    'criteria_requirement_refs',
  ],
  triage_advise: [
    'requirement_gap_refs',
    'extracted_resource_refs',
    'confidence_context',
  ],
};
