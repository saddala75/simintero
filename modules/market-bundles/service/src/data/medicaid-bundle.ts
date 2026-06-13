export const MEDICAID_STARTER_BUNDLE = {
  lob: 'Medicaid' as const,
  name: 'Medicaid Starter Bundle',
  artifact_refs: [
    { role: 'policy', ref: 'pa-standard-medicaid' },
    { role: 'clinical_criteria', ref: 'medicaid-criteria-v1' },
  ],
} as const;
