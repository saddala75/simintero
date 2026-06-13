import { describe, it, expect } from 'vitest';
import { MemberResolver } from '../member/MemberResolver.js';

describe('MemberResolver', () => {
  const resolver = new MemberResolver();

  describe('resolve (exact_id)', () => {
    it('resolvesExactMatch — given memberRef, returns it unchanged with exact_id + score 1.0', () => {
      const result = resolver.resolve('Patient/pat-001');
      expect(result.memberRef).toBe('Patient/pat-001');
      expect(result.method).toBe('exact_id');
      expect(result.score).toBe(1.0);
    });

    it('returnsInputRefForPhase1 — any memberRef passes through with score 1.0', () => {
      const inputs = [
        'Patient/abc-123',
        'urn:uuid:some-id',
        'MBID:987654',
      ];
      for (const ref of inputs) {
        const result = resolver.resolve(ref);
        expect(result.memberRef).toBe(ref);
        expect(result.method).toBe('exact_id');
        expect(result.score).toBe(1.0);
      }
    });
  });

  describe('resolveByAttributes', () => {
    it('returns score=1.0 (exact_id) when memberId matches exactly', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {
        memberId: 'Patient/pat-001',
      });
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact_id');
      expect(result.memberRef).toBe('Patient/pat-001');
    });

    it('returns score=1.0 (exact_id) when memberId matches the ID segment', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {
        memberId: 'pat-001',
      });
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact_id');
      expect(result.memberRef).toBe('Patient/pat-001');
    });

    it('returns score=0.65 (probabilistic) on name-only match', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {
        givenName: 'pat',
        familyName: '001',
      });
      expect(result.score).toBe(0.65);
      expect(result.method).toBe('probabilistic');
      expect(result.memberRef).toBe('Patient/pat-001');
    });

    it('returns score=0.0 when nothing matches', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {
        givenName: 'completely',
        familyName: 'different',
      });
      expect(result.score).toBe(0.0);
      expect(result.method).toBe('probabilistic');
    });

    it('name matching is case-insensitive', () => {
      const result = resolver.resolveByAttributes('Patient/PAT-001', {
        givenName: 'pat',
        familyName: '001',
      });
      expect(result.score).toBe(0.65);
      expect(result.method).toBe('probabilistic');
    });

    it('returns score=0.0 when only empty/undefined names provided', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {});
      expect(result.score).toBe(0.0);
      expect(result.method).toBe('probabilistic');
    });

    it('no-match fallback uses memberId as memberRef when provided', () => {
      const result = resolver.resolveByAttributes('Patient/pat-001', {
        memberId: 'other-id',
        givenName: 'completely',
        familyName: 'different',
      });
      // memberId !== candidateRef and !== candidateId, so falls through to no-match
      expect(result.score).toBe(0.0);
      expect(result.memberRef).toBe('other-id');
    });
  });
});
