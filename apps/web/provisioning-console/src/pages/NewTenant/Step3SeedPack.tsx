import { SeedPackSelector } from '../../components/SeedPackSelector.js';
import type { WizardData } from './types.js';

interface Props {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

export function Step3SeedPack({ data, onChange }: Props) {
  const lob = data.compliance_baseline || 'MA';

  return (
    <div>
      <h3>Seed Pack</h3>
      <p>Select a seed pack for line of business: <strong>{lob}</strong></p>
      <SeedPackSelector
        lob={lob}
        selected={data.selected_seed_pack}
        onSelect={(canonicalUrl) => onChange({ selected_seed_pack: canonicalUrl })}
      />
    </div>
  );
}
