export interface WizardData {
  display: string;
  env_kind: 'sandbox' | 'uat' | 'prod' | '';
  env_group: string;
  compliance_baseline: 'MA' | 'MEDICAID' | 'COMMERCIAL' | 'PUBLIC' | '';
  tier: 'pooled' | 'dedicated' | 'enclave' | '';
  region: string;
  selected_seed_pack: string;
}
