import { describe, it, expect } from 'vitest';
import { BundleValidator } from '../BundleValidator.js';

describe('BundleValidator', () => {
  const validator = new BundleValidator();

  it('valid when status is draft and reviewer_id is present', () => {
    const result = validator.validate({
      bundle_id: 'bundle-1',
      tenant_id: 'tenant-a',
      reviewer_id: 'dr-smith',
      current_status: 'draft',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('invalid when reviewer_id is missing', () => {
    const result = validator.validate({
      bundle_id: 'bundle-1',
      tenant_id: 'tenant-a',
      reviewer_id: undefined,
      current_status: 'draft',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('reviewer_id_required'))).toBe(true);
  });

  it('invalid when reviewer_id is empty string', () => {
    const result = validator.validate({
      bundle_id: 'bundle-1',
      tenant_id: 'tenant-a',
      reviewer_id: '',
      current_status: 'draft',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('reviewer_id_required'))).toBe(true);
  });

  it('invalid when current_status is not draft', () => {
    const result = validator.validate({
      bundle_id: 'bundle-1',
      tenant_id: 'tenant-a',
      reviewer_id: 'dr-smith',
      current_status: 'active',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cannot_activate'))).toBe(true);
  });

  it('returns both errors when status is wrong AND reviewer_id missing', () => {
    const result = validator.validate({
      bundle_id: 'bundle-1',
      tenant_id: 'tenant-a',
      reviewer_id: undefined,
      current_status: 'retired',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
