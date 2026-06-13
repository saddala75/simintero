export const COMMERCIAL_STARTER_BUNDLE = {
  lob: 'Commercial' as const,
  name: 'Commercial Starter Bundle',
  artifact_refs: [
    { role: 'policy', ref: 'pa-standard-commercial' },
    { role: 'clinical_criteria', ref: 'commercial-criteria-v1' },
  ],
} as const;
