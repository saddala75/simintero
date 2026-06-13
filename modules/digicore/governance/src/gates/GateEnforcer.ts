export interface ApprovalRecord {
  gate: 'clinical' | 'compliance';
  approver: string;
  decision: 'approved' | 'rejected';
  recorded_at: string;
}

export interface ArtifactApprovalState {
  artifact_id: string;
  created_by: string;
  approvals: ApprovalRecord[];
}

export type Gate = 'clinical' | 'compliance';

export interface SodError {
  code: 'SIM-GOV-SOD';
  status: 403;
}

export class GateEnforcer {
  /**
   * Checks that the approver is not the same as the artifact author.
   * Throws { code: 'SIM-GOV-SOD', status: 403 } on violation.
   */
  checkSegregationOfDuties(approver: string, authorId: string): void {
    if (approver === authorId) {
      throw { code: 'SIM-GOV-SOD', status: 403 } satisfies SodError;
    }
  }

  /**
   * Checks whether both 'clinical' and 'compliance' gates have been approved.
   * A rejected gate is treated as not approved (must be re-approved).
   */
  checkActivationReady(state: ArtifactApprovalState): { ready: boolean; missingGates: Gate[] } {
    const requiredGates: Gate[] = ['clinical', 'compliance'];
    const missingGates: Gate[] = [];

    for (const gate of requiredGates) {
      // Check the latest record for this gate — it must be 'approved'
      const latest = state.approvals.filter(a => a.gate === gate).at(-1);
      if (latest === undefined || latest.decision !== 'approved') {
        missingGates.push(gate);
      }
    }

    return { ready: missingGates.length === 0, missingGates };
  }
}
