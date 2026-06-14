import { describe, it, expect } from 'vitest';
import { reduce, replayEvents } from '../aggregate/reducers.js';
import type { CaseState, CaseEvent } from '../aggregate/types.js';

function makeSeed(overrides?: Partial<CaseState>): CaseState {
  return {
    caseId: 'case-uuid-001',
    tenantId: 't_test',
    status: 'intake',
    urgency: 'standard',
    channel: 'PAS',
    lob: 'MA',
    memberRef: 'Patient/pat-001',
    coverageRef: 'Coverage/cov-001',
    pins: [],
    linked: { appeal_of: null, related_cases: [] },
    events: [],
    ...overrides,
  };
}

describe('Case Aggregate Reducers — pa-standard-ma.yaml transitions', () => {
  // intake → completeness_check (trigger: case.created)
  it('CaseStateChanged to completeness_check changes status', () => {
    const state = makeSeed();
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'completeness_check',
      trigger: 'case.created',
      payload: { to: 'completeness_check', trigger: 'case.created' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('completeness_check');
  });

  // completeness_check → pend_rfi (trigger: completeness.gap_found)
  it('CaseStateChanged to pend_rfi changes status', () => {
    const state = makeSeed({ status: 'completeness_check' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'pend_rfi',
      trigger: 'completeness.gap_found',
      payload: { to: 'pend_rfi', trigger: 'completeness.gap_found' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('pend_rfi');
  });

  // completeness_check → clinical_review (trigger: completeness.complete)
  it('CaseStateChanged to clinical_review changes status', () => {
    const state = makeSeed({ status: 'completeness_check' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'clinical_review',
      trigger: 'completeness.complete',
      payload: { to: 'clinical_review', trigger: 'completeness.complete' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('clinical_review');
  });

  // pend_rfi → clinical_review (trigger: rfi.satisfied)
  it('CaseStateChanged to clinical_review from pend_rfi changes status', () => {
    const state = makeSeed({ status: 'pend_rfi' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'clinical_review',
      trigger: 'rfi.satisfied',
      payload: { to: 'clinical_review', trigger: 'rfi.satisfied' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('clinical_review');
  });

  // pend_rfi → determined (trigger: rfi.deadline_expired)
  it('CaseStateChanged to determined from pend_rfi (deadline expired)', () => {
    const state = makeSeed({ status: 'pend_rfi' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'determined',
      trigger: 'rfi.deadline_expired',
      payload: { to: 'determined', trigger: 'rfi.deadline_expired' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('determined');
  });

  // clinical_review → determined (trigger: decision.recorded)
  it('CaseStateChanged to determined changes to terminal state', () => {
    const state = makeSeed({ status: 'clinical_review' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'determined',
      trigger: 'decision.recorded',
      payload: { to: 'determined', trigger: 'decision.recorded' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('determined');
  });

  // [any non-terminal] → withdrawn (trigger: member.withdrawal)
  it('CaseStateChanged to withdrawn from intake', () => {
    const state = makeSeed({ status: 'intake' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
      payload: { to: 'withdrawn', trigger: 'member.withdrawal' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('withdrawn');
  });

  it('CaseStateChanged to withdrawn from completeness_check', () => {
    const state = makeSeed({ status: 'completeness_check' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
      payload: { to: 'withdrawn', trigger: 'member.withdrawal' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('withdrawn');
  });

  it('CaseStateChanged to withdrawn from pend_rfi', () => {
    const state = makeSeed({ status: 'pend_rfi' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
      payload: { to: 'withdrawn', trigger: 'member.withdrawal' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('withdrawn');
  });

  it('CaseStateChanged to withdrawn from clinical_review', () => {
    const state = makeSeed({ status: 'clinical_review' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
      payload: { to: 'withdrawn', trigger: 'member.withdrawal' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('withdrawn');
  });

  // [intake|completeness_check] → voided (trigger: case.duplicate_detected)
  it('CaseStateChanged to voided from intake', () => {
    const state = makeSeed({ status: 'intake' });
    const event: CaseEvent = {
      type: 'CaseStateChanged',
      case_id: 'case-uuid-001',
      to: 'voided',
      trigger: 'case.duplicate_detected',
      payload: { to: 'voided', trigger: 'case.duplicate_detected' },
    };
    const next = reduce(state, event);
    expect(next.status).toBe('voided');
  });

  // PinAppended — append-only: does not remove existing pins
  it('PinAppended appends to pins without removing existing ones', () => {
    const state = makeSeed({
      pins: [{ canonical_url: 'urn:sim:policy:existing', version: '1.0' }],
    });
    const event: CaseEvent = {
      type: 'PinAppended',
      case_id: 'case-uuid-001',
      canonical_url: 'urn:sim:policy:new',
      version: '2.0',
      payload: { canonical_url: 'urn:sim:policy:new', version: '2.0' },
    };
    const next = reduce(state, event);
    expect(next.pins).toHaveLength(2);
    expect(next.pins[0]).toEqual({ canonical_url: 'urn:sim:policy:existing', version: '1.0' });
    expect(next.pins[1]).toEqual({ canonical_url: 'urn:sim:policy:new', version: '2.0' });
    // Original state unchanged (immutability)
    expect(state.pins).toHaveLength(1);
  });

  // CaseLinked updates linked structure
  it('CaseLinked updates linked structure', () => {
    const state = makeSeed();
    const newLinked = { appeal_of: 'case-uuid-000', related_cases: ['case-uuid-002'] };
    const event: CaseEvent = {
      type: 'CaseLinked',
      case_id: 'case-uuid-001',
      payload: { linked: newLinked },
    };
    const next = reduce(state, event);
    expect(next.linked.appeal_of).toBe('case-uuid-000');
    expect(next.linked.related_cases).toEqual(['case-uuid-002']);
  });

  // replayEvents reconstructs state through a sequence
  it('replayEvents: full sequence intake → completeness_check → clinical_review → determined', () => {
    const seed = makeSeed();
    const events: CaseEvent[] = [
      {
        type: 'CaseStateChanged',
        case_id: 'case-uuid-001',
        to: 'completeness_check',
        trigger: 'case.created',
        payload: {},
      },
      {
        type: 'CaseStateChanged',
        case_id: 'case-uuid-001',
        to: 'clinical_review',
        trigger: 'completeness.complete',
        payload: {},
      },
      {
        type: 'CaseStateChanged',
        case_id: 'case-uuid-001',
        to: 'determined',
        trigger: 'decision.recorded',
        payload: {},
      },
    ];
    const final = replayEvents(seed, events);
    expect(final.status).toBe('determined');
  });
});
