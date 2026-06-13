import type { WizardData } from './types.js';

interface Props {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

export function Step2Infrastructure({ data, onChange }: Props) {
  return (
    <div>
      <h3>Infrastructure</h3>

      <div>
        <label htmlFor="tier">Tier</label>
        <select
          id="tier"
          value={data.tier}
          onChange={(e) =>
            onChange({ tier: e.target.value as WizardData['tier'] })
          }
        >
          <option value="">-- Select --</option>
          <option value="pooled">pooled</option>
          <option value="dedicated">dedicated</option>
          <option value="enclave">enclave</option>
        </select>
      </div>

      <div>
        <label htmlFor="region">Region</label>
        <input
          id="region"
          type="text"
          value={data.region}
          onChange={(e) => onChange({ region: e.target.value })}
        />
      </div>
    </div>
  );
}
