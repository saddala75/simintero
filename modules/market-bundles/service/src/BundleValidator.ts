export interface BundleActivationRequest {
  bundle_id: string;
  tenant_id: string;
  reviewer_id: string | undefined;
  current_status: string;
}

export interface BundleValidationResult {
  valid: boolean;
  errors: string[];
}

// HUMAN_REVIEW: BundleValidator is the sole enforcement point for the draft→active promotion gate.
// Any change to allow() logic requires clinical and compliance sign-off.
export class BundleValidator {
  validate(req: BundleActivationRequest): BundleValidationResult {
    const errors: string[] = [];

    if (req.current_status !== 'draft') {
      errors.push(`cannot_activate: current status is '${req.current_status}', expected 'draft'`);
    }

    if (!req.reviewer_id || req.reviewer_id.trim() === '') {
      errors.push('reviewer_id_required: a human reviewer must authorize bundle activation');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
