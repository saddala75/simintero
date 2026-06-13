import { describe, it, expect } from 'vitest';
import { GateEnforcer } from '../gates/GateEnforcer.js';
import type { ArtifactApprovalState } from '../gates/GateEnforcer.js';

describe('GateEnforcer', () => {
  const enforcer = new GateEnforcer();

  // ── Segregation of Duties ────────────────────────────────────────────────

  it('throws { code: SIM-GOV-SOD, status: 403 } when approver === author', () => {
    let caughtError: unknown;
    try {
      enforcer.checkSegregationOfDuties('user-1', 'user-1');
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toMatchObject({ code: 'SIM-GOV-SOD', status: 403 });
  });

  it('does not throw when approver is different from author', () => {
    expect(() =>
      enforcer.checkSegregationOfDuties('reviewer-1', 'author-1'),
    ).not.toThrow();
  });

  // ── Activation Readiness ─────────────────────────────────────────────────

  it('returns { ready: false, missingGates: ["compliance"] } when only clinical is approved', () => {
    const state: ArtifactApprovalState = {
      artifact_id: 'artifact-1',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
    };

    const result = enforcer.checkActivationReady(state);

    expect(result.ready).toBe(false);
    expect(result.missingGates).toEqual(['compliance']);
  });

  it('returns { ready: true, missingGates: [] } when both gates are approved', () => {
    const state: ArtifactApprovalState = {
      artifact_id: 'artifact-1',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
        {
          gate: 'compliance',
          approver: 'officer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
    };

    const result = enforcer.checkActivationReady(state);

    expect(result.ready).toBe(true);
    expect(result.missingGates).toEqual([]);
  });

  it('returns { ready: false, missingGates: ["clinical","compliance"] } with no approvals', () => {
    const state: ArtifactApprovalState = {
      artifact_id: 'artifact-1',
      created_by: 'author-1',
      approvals: [],
    };

    const result = enforcer.checkActivationReady(state);

    expect(result.ready).toBe(false);
    expect(result.missingGates).toEqual(['clinical', 'compliance']);
  });

  it('treats a rejected gate as missing (must re-approve)', () => {
    const state: ArtifactApprovalState = {
      artifact_id: 'artifact-1',
      created_by: 'author-1',
      approvals: [
        {
          gate: 'clinical',
          approver: 'reviewer-1',
          decision: 'rejected',
          recorded_at: new Date().toISOString(),
        },
        {
          gate: 'compliance',
          approver: 'officer-1',
          decision: 'approved',
          recorded_at: new Date().toISOString(),
        },
      ],
    };

    const result = enforcer.checkActivationReady(state);

    expect(result.ready).toBe(false);
    expect(result.missingGates).toContain('clinical');
  });
});
