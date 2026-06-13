export const MA_STARTER_BUNDLE = {
  lob: 'MA' as const,
  name: 'Medicare Advantage Starter Bundle',
  artifact_refs: [
    { role: 'policy', ref: 'pa-standard-ma' },
    { role: 'clinical_criteria', ref: 'ma-clinical-criteria-v1' },
  ],
} as const;
