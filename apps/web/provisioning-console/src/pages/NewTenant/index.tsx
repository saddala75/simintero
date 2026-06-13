import { useState } from 'react';
import type { TenantCreateInput } from '../../api/controlPlaneClient.js';
import { controlPlaneClient } from '../../api/controlPlaneClient.js';
import type { WizardData } from './types.js';
import { Step1Identity } from './Step1Identity.js';
import { Step2Infrastructure } from './Step2Infrastructure.js';
import { Step3SeedPack } from './Step3SeedPack.js';
import { Step4Review } from './Step4Review.js';

export type { WizardData };

interface Props {
  onComplete: (operationId: string) => void;
}

const INITIAL_DATA: WizardData = {
  display: '',
  env_kind: '',
  env_group: '',
  compliance_baseline: '',
  tier: '',
  region: '',
  selected_seed_pack: '',
};

function isStepValid(step: number, data: WizardData): boolean {
  switch (step) {
    case 1:
      return (
        data.display.trim() !== '' &&
        data.env_kind !== '' &&
        data.env_group.trim() !== '' &&
        data.compliance_baseline !== ''
      );
    case 2:
      return data.tier !== '' && data.region.trim() !== '';
    case 3:
      return true;
    case 4:
      return true;
    default:
      return false;
  }
}

const STEP_LABELS = ['Tenant Identity', 'Infrastructure', 'Seed Pack', 'Review'];

export function NewTenantWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(updates: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...updates }));
  }

  function handleNext() {
    if (step < 4) {
      setStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (step > 1) {
      setStep((s) => s - 1);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: TenantCreateInput = {
        display: data.display,
        tier: data.tier as TenantCreateInput['tier'],
        env_kind: data.env_kind as TenantCreateInput['env_kind'],
        env_group: data.env_group,
        region: data.region,
        compliance_baseline: data.compliance_baseline as TenantCreateInput['compliance_baseline'],
      };
      const result = await controlPlaneClient.createTenant(input);
      onComplete(result.operation_id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  }

  const valid = isStepValid(step, data);
  const isFirst = step === 1;
  const isLast = step === 4;

  return (
    <div>
      <h2>New Tenant</h2>

      <nav aria-label="Wizard steps">
        <ol>
          {STEP_LABELS.map((label, idx) => (
            <li key={label} aria-current={step === idx + 1 ? 'step' : undefined}>
              {idx + 1}. {label}
            </li>
          ))}
        </ol>
      </nav>

      <div>
        {step === 1 && <Step1Identity data={data} onChange={handleChange} />}
        {step === 2 && <Step2Infrastructure data={data} onChange={handleChange} />}
        {step === 3 && <Step3SeedPack data={data} onChange={handleChange} />}
        {step === 4 && (
          <Step4Review data={data} submitting={submitting} error={submitError} />
        )}
      </div>

      <div>
        <button type="button" onClick={handleBack} disabled={isFirst}>
          Back
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={submitting}
          >
            Submit
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={!valid}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
