import type { WizardData } from './types.js';

interface Props {
  data: WizardData;
  submitting: boolean;
  error: string | null;
}

export function Step4Review({ data, submitting, error }: Props) {
  return (
    <div>
      <h3>Review &amp; Submit</h3>

      <dl>
        <dt>Display Name</dt>
        <dd>{data.display}</dd>

        <dt>Environment Kind</dt>
        <dd>{data.env_kind}</dd>

        <dt>Environment Group</dt>
        <dd>{data.env_group}</dd>

        <dt>Compliance Baseline</dt>
        <dd>{data.compliance_baseline}</dd>

        <dt>Tier</dt>
        <dd>{data.tier}</dd>

        <dt>Region</dt>
        <dd>{data.region}</dd>

        <dt>Seed Pack</dt>
        <dd>{data.selected_seed_pack || '(none selected)'}</dd>
      </dl>

      {submitting && <p aria-live="polite">Provisioning tenant…</p>}
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
