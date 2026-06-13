import type { WizardData } from './types.js';

interface Props {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

export function Step1Identity({ data, onChange }: Props) {
  return (
    <div>
      <h3>Tenant Identity</h3>

      <div>
        <label htmlFor="display">Display Name</label>
        <input
          id="display"
          type="text"
          value={data.display}
          onChange={(e) => onChange({ display: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="env_kind">Environment Kind</label>
        <select
          id="env_kind"
          value={data.env_kind}
          onChange={(e) =>
            onChange({ env_kind: e.target.value as WizardData['env_kind'] })
          }
        >
          <option value="">-- Select --</option>
          <option value="sandbox">sandbox</option>
          <option value="uat">uat</option>
          <option value="prod">prod</option>
        </select>
      </div>

      <div>
        <label htmlFor="env_group">Environment Group</label>
        <input
          id="env_group"
          type="text"
          value={data.env_group}
          onChange={(e) => onChange({ env_group: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="compliance_baseline">Compliance Baseline</label>
        <select
          id="compliance_baseline"
          value={data.compliance_baseline}
          onChange={(e) =>
            onChange({
              compliance_baseline: e.target.value as WizardData['compliance_baseline'],
            })
          }
        >
          <option value="">-- Select --</option>
          <option value="MA">MA</option>
          <option value="MEDICAID">MEDICAID</option>
          <option value="COMMERCIAL">COMMERCIAL</option>
          <option value="PUBLIC">PUBLIC</option>
        </select>
      </div>
    </div>
  );
}
