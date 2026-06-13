export interface MemberResolution {
  memberRef: string;
  method: 'exact_id' | 'probabilistic';
  score: number;
}

export interface MemberAttributes {
  memberId?: string;
  givenName?: string;
  familyName?: string;
  dob?: string; // ISO 8601: YYYY-MM-DD
}

/**
 * Phase 1: exact-ID member resolution.
 * Phase 2: probabilistic resolution against member attributes.
 */
export class MemberResolver {
  /**
   * Phase 1 exact-ID resolution. Returns score=1.0.
   */
  resolve(memberRef: string): MemberResolution {
    return { memberRef, method: 'exact_id', score: 1.0 };
  }

  /**
   * Phase 2 probabilistic resolution against member attributes.
   * Returns the best matching memberRef with a confidence score.
   *
   * Scoring algorithm:
   *   - Exact memberId match:  score=1.0 (exact_id method)
   *   - Name + DOB match:      score=0.85 (probabilistic)
   *   - Name match only:       score=0.65 (probabilistic)
   *   - No match:              score=0.0  (probabilistic, memberRef=attrs.memberId or candidateRef)
   *
   * Names are compared case-insensitively with leading/trailing whitespace stripped.
   * DOB matched exactly (YYYY-MM-DD string comparison).
   */
  resolveByAttributes(
    candidateRef: string,
    attrs: MemberAttributes,
  ): MemberResolution {
    const { memberId, givenName, familyName, dob } = attrs;

    // Extract candidate ID segment from memberRef (e.g. "Patient/pat-001" → "pat-001")
    const candidateId = candidateRef.split('/').pop() ?? candidateRef;

    // Exact memberId match
    if (memberId && (memberId === candidateRef || memberId === candidateId)) {
      return { memberRef: candidateRef, method: 'exact_id', score: 1.0 };
    }

    // Name + DOB match
    const nameMatch = this.namesMatch(givenName, familyName, candidateRef);
    if (nameMatch && dob && this.dobMatch(dob, candidateRef)) {
      return { memberRef: candidateRef, method: 'probabilistic', score: 0.85 };
    }

    // Name-only match
    if (nameMatch) {
      return { memberRef: candidateRef, method: 'probabilistic', score: 0.65 };
    }

    // No match
    return {
      memberRef: memberId ?? candidateRef,
      method: 'probabilistic',
      score: 0.0,
    };
  }

  private namesMatch(
    givenName: string | undefined,
    familyName: string | undefined,
    memberRef: string,
  ): boolean {
    if (!givenName && !familyName) return false;
    // Check if memberRef contains name segments (case-insensitive)
    const ref = memberRef.toLowerCase();
    const given = givenName?.toLowerCase().trim();
    const family = familyName?.toLowerCase().trim();
    return (!given || ref.includes(given)) && (!family || ref.includes(family));
  }

  /**
   * Protected so tests can override without a DB.
   * Phase 2 production: query fabric.resource for the Patient DOB.
   * For now always returns false (no DOB data available without DB),
   * preventing false-positive DOB matches while retaining the interface contract.
   */
  protected dobMatch(dob: string, _memberRef: string): boolean {
    void dob;
    return false;
  }
}
