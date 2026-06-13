import { useState, useCallback } from 'react';
import type { DeterminationOutcome } from '../types.js';
import { useCaseDetail } from '../hooks/useCaseDetail.js';
import { useRulesTrace } from '../hooks/useRulesTrace.js';
import { useAdvisory } from '../hooks/useAdvisory.js';
import { useWorklist } from '../hooks/useWorklist.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { RECORD_DECISION_MUTATION, ROUTE_CASE_MUTATION } from '../graphql/mutations.js';

interface CaseReviewProps {
  caseId: string;
  roles: string[];
  onBack: () => void;
  onSelectCase: (caseId: string) => void;
  onDetermination: (caseId: string) => void;
}

function shortId(id: string) { return id.slice(-8).toUpperCase(); }

function stateChipClass(state: string) {
  switch (state) {
    case 'IN_REVIEW':    return 'in-review';
    case 'PENDING_INFO': return 'pending-info';
    case 'APPROVED':     return 'approved';
    case 'DENIED':       return 'denied';
    case 'MODIFIED':     return 'modified';
    default:             return 'received';
  }
}

function stateLabel(state: string) {
  switch (state) {
    case 'IN_REVIEW':    return 'In Review';
    case 'PENDING_INFO': return 'Awaiting Info';
    case 'APPROVED':     return 'Approved';
    case 'DENIED':       return 'Denied';
    case 'MODIFIED':     return 'Modified';
    default:             return 'Received';
  }
}

type TriageSuggestion = 'likely_meets' | 'needs_rfi' | 'route_to_clinician';

const TRIAGE_MAP: Record<TriageSuggestion, string> = {
  likely_meets:        'Likely meets criteria — recommend approval',
  needs_rfi:           'Additional information needed before decision',
  route_to_clinician:  'Route to MD for clinical determination',
};

function CriterionItem({ name, result, url, version, index }: {
  name: string;
  result: boolean | 'indeterminate';
  url: string;
  version: string;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const cls = result === true ? 'met' : result === false ? 'gap' : 'unk';
  const icon = result === true ? '✓' : result === false ? '✗' : '?';
  const label = result === true ? 'Met' : result === false ? 'Gap' : 'Indeterminate';

  return (
    <div className={`crit ${open ? 'open' : ''}`}>
      <button className="crit-h" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`stat-ic ${cls}`} aria-hidden="true">{icon}</span>
        <div>
          <div className="cnum">C-{String(index + 1).padStart(2, '0')}</div>
          <div className="ctext">{name}</div>
        </div>
        <span className={`cstat ${cls}`}>{label}</span>
        <svg className="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      <div className="crit-b">
        <div className="crit-artifact">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
          <span style={{ flexShrink: 0 }}>v{version}</span>
        </div>
        {result === false && (
          <div style={{ marginTop: 10, color: 'var(--amber)', fontWeight: 600, fontSize: 12.5 }}>
            ⚠ Criterion not met — include finding in determination rationale
          </div>
        )}
      </div>
    </div>
  );
}

function QuickApproveModal({ onSubmit, onClose, pending }: {
  onSubmit: (rationale: string) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [rationale, setRationale] = useState('');
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Approve case">
      <div className="modal">
        <h2>Approve Case</h2>
        <p style={{ color: 'var(--ink-mut)', fontSize: 13, marginBottom: 12 }}>
          Record your clinical rationale for approval. This action is final and logged.
        </p>
        <textarea
          className="det-textarea"
          rows={4}
          placeholder="Enter rationale (optional for approvals)…"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
        />
        <div className="modal-actions">
          <button className="act" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="act primary" onClick={() => onSubmit(rationale)} disabled={pending}>
            {pending ? 'Submitting…' : 'Confirm Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CaseReview({ caseId, roles, onBack, onSelectCase, onDetermination }: CaseReviewProps) {
  const ctx = useSimCtx();
  const [railOpen, setRailOpen] = useState(true);
  const [showApprove, setShowApprove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [composerText, setComposerText] = useState('');

  const { caseDetail, loading, error } = useCaseDetail(caseId);
  const { criteria } = useRulesTrace(caseId);
  const { advisory } = useAdvisory(caseId);
  const { cases: queueCases } = useWorklist();

  const isMD = roles.includes('medical_director');
  const gapCriteria = criteria.filter(c => c.result === false);

  const handleRequestInfo = useCallback(async () => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{ routeCase: { taskId: string | null; error: string | null } }>(
        ROUTE_CASE_MUTATION,
        { input: { caseId, toQueue: 'rfi', reason: 'Additional information requested by reviewer' } },
        ctx,
      );
      if (data.routeCase.error) setActionError(data.routeCase.error);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  const handleRoute = useCallback(async () => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{ routeCase: { taskId: string | null; error: string | null } }>(
        ROUTE_CASE_MUTATION,
        { input: { caseId, toQueue: 'peer_review', reason: 'Referred to MD by reviewer' } },
        ctx,
      );
      if (data.routeCase.error) setActionError(data.routeCase.error);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  const handleApprove = useCallback(async (rationale: string) => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{
        recordDecision: { determinationId: string | null; error: string | null; errorCode: string | null };
      }>(
        RECORD_DECISION_MUTATION,
        { input: { caseId, outcome: 'approved' as DeterminationOutcome, rationale } },
        ctx,
      );
      if (data.recordDecision.error) {
        setActionError(data.recordDecision.error);
      } else {
        setShowApprove(false);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  if (loading) {
    return (
      <div className="case-shell">
        <div className="case-area">
          <div className="loading-state"><div className="spin" />Loading case…</div>
        </div>
      </div>
    );
  }

  if (error || !caseDetail) {
    return (
      <div className="case-shell">
        <div className="case-area" style={{ padding: 24 }}>
          <div className="alert-bar">{error ?? 'Case not found.'}</div>
          <button className="back-link" style={{ marginTop: 12 }} onClick={onBack}>← Back to worklist</button>
        </div>
      </div>
    );
  }

  const triageSuggestion = advisory?.triage?.status === 'ok' ? advisory.triage.suggestion : null;
  const assertions = advisory?.summary?.status === 'ok' ? (advisory.summary.assertions ?? []) : [];

  return (
    <div className="case-shell">
      {/* Left Worklist Rail */}
      <div className={`wl-rail ${railOpen ? '' : 'collapsed'}`} aria-label="Case queue">
        {railOpen && (
          <>
            <div className="wl-rail-head">
              <div className="t">Queue</div>
              <div className="s">{queueCases.length} cases</div>
            </div>
            <div className="wl-rail-list">
              {queueCases.map(c => (
                <button
                  key={c.case_id}
                  className={`qitem ${c.case_id === caseId ? 'active' : ''}`}
                  onClick={() => onSelectCase(c.case_id)}
                >
                  <div className="qtop">
                    <span className="qid">PA-{shortId(c.case_id)}</span>
                    <span className={`clk ${c.urgency === 'expedited' ? 'crit' : 'ok'}`}>
                      {c.urgency === 'expedited' ? 'Exp' : 'Std'}
                    </span>
                  </div>
                  <div className="qsvc">{c.lob}</div>
                  <div className="qmeta">{stateLabel(c.state)}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Main Case Area */}
      <div className="case-area">
        {/* Command Bar */}
        <div className="cmd">
          <button
            className="railtoggle"
            onClick={() => setRailOpen(o => !o)}
            aria-label={railOpen ? 'Collapse queue rail' : 'Expand queue rail'}
            title={railOpen ? 'Collapse queue' : 'Expand queue'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M2 8h8M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="cmd-id">
            <div className="top">
              <span className="cid">PA-{shortId(caseDetail.case_id)}</span>
              <span className={`pri-badge ${caseDetail.urgency === 'expedited' ? '' : 'std'}`}>
                {caseDetail.urgency}
              </span>
              <span className={`state-chip ${stateChipClass(caseDetail.state)}`}>
                {stateLabel(caseDetail.state)}
              </span>
            </div>
            <div className="sub">
              LOB: <b>{caseDetail.lob}</b>
              {caseDetail.member_ref && <> · Member: <b>{caseDetail.member_ref}</b></>}
            </div>
          </div>

          <div className="clock-box">
            <div className="clock-lbl">Decision clock</div>
            <div className="clock-val">—:——</div>
          </div>

          <div className="actions">
            <button className="act" onClick={() => { void handleRequestInfo(); }} disabled={actionPending}>
              Request Info
            </button>
            {!isMD && (
              <button className="act" onClick={() => { void handleRoute(); }} disabled={actionPending}>
                Refer to MD
              </button>
            )}
            {isMD ? (
              <button className="act primary" onClick={() => onDetermination(caseId)} disabled={actionPending}>
                Record Determination
              </button>
            ) : (
              <button className="act primary" onClick={() => setShowApprove(true)} disabled={actionPending}>
                Approve
              </button>
            )}
          </div>
        </div>

        {/* Action error */}
        {actionError && (
          <div className="alert-bar" style={{ margin: '0 20px 0', borderRadius: 0, borderLeft: 0, borderRight: 0 }} role="alert">
            Action failed: {actionError}
          </div>
        )}

        {/* 3-Column Content */}
        <div className="content">
          {/* Left: Context */}
          <div className="col ctx">
            <div className="panel">
              <div className="panel-h">
                <span className="pt">Member &amp; Coverage</span>
              </div>
              <div className="panel-b">
                <div className="kv">
                  <span className="k">Member ref</span>
                  <span className="v">{caseDetail.member_ref || '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">Line of business</span>
                  <span className="v">{caseDetail.lob}</span>
                </div>
                <div className="kv">
                  <span className="k">Urgency</span>
                  <span className="v">
                    <span className={`pillbadge`} style={
                      caseDetail.urgency === 'expedited'
                        ? { background: 'var(--red-tint)', color: 'var(--red)' }
                        : {}
                    }>
                      {caseDetail.urgency}
                    </span>
                  </span>
                </div>
                <div className="kv">
                  <span className="k">State</span>
                  <span className="v">{stateLabel(caseDetail.state)}</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <span className="pt">Requested Services</span>
                <span className="lbl">{caseDetail.service_lines.length} line{caseDetail.service_lines.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="panel-b">
                {caseDetail.service_lines.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--ink-mut)', fontSize: 13 }}>No service lines on file.</p>
                ) : (
                  caseDetail.service_lines.map(line => (
                    <div key={line.line_id} className="svcline">
                      <div className="code">{line.code.code} <span style={{ color: 'var(--ink-mut)', fontSize: 10 }}>({line.code.system})</span></div>
                      <div className="name">Qty: {line.qty}</div>
                      <div className="meta">
                        {line.status}
                        {line.place_of_service ? ` · ${line.place_of_service}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Center: Work */}
          <div className="col work">
            <div className="work-head">
              <h2>Clinical Review</h2>
              <div className="policy-pin">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2l1.5 3 3.5.5-2.5 2.5.5 3.5L8 10l-3 1.5.5-3.5L3 5.5l3.5-.5L8 2z" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                <b>ens.criteria</b> · active policy
              </div>
            </div>

            {gapCriteria.length > 0 && (
              <div className="gapbar">
                <svg className="gi" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2l6 12H2L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  <path d="M8 6v4M8 11.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <div>
                  <div className="gt">{gapCriteria.length} criterion gap{gapCriteria.length > 1 ? 's' : ''} identified</div>
                  <div className="gs">Review unmet criteria before recording determination</div>
                </div>
              </div>
            )}

            {criteria.length === 0 ? (
              <div className="panel">
                <div className="panel-b" style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
                  No criteria trace available for this case.
                </div>
              </div>
            ) : (
              criteria.map((c, i) => (
                <CriterionItem
                  key={`${c.expression_name}-${i}`}
                  name={c.expression_name}
                  result={c.result}
                  url={c.artifact_canonical_url}
                  version={c.artifact_version}
                  index={i}
                />
              ))
            )}

            <div className="composer">
              <div className="composer-h">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 13V3a1 1 0 011-1h8a1 1 0 011 1v10l-5-3-5 3z" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                <span className="ct">Reviewer Notes</span>
              </div>
              <div className="composer-b">
                {triageSuggestion && (
                  <div className="rec">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--pine)', marginTop: 2 }} aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M8 5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <div className="rt">AI Advisory</div>
                      <div className="rs">{TRIAGE_MAP[triageSuggestion]}</div>
                    </div>
                  </div>
                )}
                <textarea
                  placeholder="Add clinical notes or rationale for this review…"
                  value={composerText}
                  onChange={e => setComposerText(e.target.value)}
                />
                <div className="guard">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2L3 5v4c0 3 5 5 5 5s5-2 5-5V5L8 2z" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                  Notes are saved to the case record. Final determination requires authorization.
                </div>
              </div>
            </div>
          </div>

          {/* Right: AI Advisory */}
          <div className="col ai">
            {!advisory && (
              <div className="ai-card">
                <div className="ai-card-h">
                  <div className="at">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M5.5 8.5c.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="6.5" r=".8" fill="currentColor"/>
                      <circle cx="10" cy="6.5" r=".8" fill="currentColor"/>
                    </svg>
                    Governed AI Advisory
                    <span className="advisory-chip">Advisory only</span>
                  </div>
                </div>
                <p className="ai-absent">Advisory not available for this case.</p>
              </div>
            )}

            {advisory && (
              <>
                {advisory.status === 'partial' && (
                  <div className="alert-bar" style={{ marginBottom: 14, background: 'var(--amber-tint)', color: 'var(--amber)', borderColor: 'rgba(181,120,14,.3)' }} role="alert">
                    AI analysis incomplete — some sections unavailable. Human review required.
                  </div>
                )}


                <div className="ai-card">
                  <div className="ai-card-h">
                    <div className="at">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M5.5 8.5c.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                        <circle cx="6" cy="6.5" r=".8" fill="currentColor"/>
                        <circle cx="10" cy="6.5" r=".8" fill="currentColor"/>
                      </svg>
                      Governed AI Advisory
                    </div>
                    <span className="advisory-chip">Advisory only</span>
                  </div>
                  <div className="ai-card-b">
                    {triageSuggestion && (
                      <div className="triage-suggest">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M8 2l1.5 3 3.5.5-2.5 2.5.5 3.5L8 10l-3 1.5.5-3.5L3 5.5l3.5-.5L8 2z" stroke="currentColor" strokeWidth="1.3"/>
                        </svg>
                        {TRIAGE_MAP[triageSuggestion]}
                        {advisory.triage?.confidence !== undefined && (
                          <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'var(--ink-mut)' }}>
                            {Math.round(advisory.triage.confidence * 100)}%
                          </span>
                        )}
                      </div>
                    )}

                    {assertions.length > 0 && (
                      <div className="ai-sug">
                        <div className="ai-sug-head">Advisory suggestions</div>
                        {assertions.map(assertion => (
                          <div key={assertion.id} className="sg">
                            <svg style={{ color: 'var(--pine)', flexShrink: 0, marginTop: 2 }} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                              <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                            <div style={{ flex: 1 }}>
                              <div className="sgt">{assertion.text}</div>
                              <div className="conf">Confidence: {Math.round(assertion.confidence * 100)}%</div>
                              {assertion.citations.length > 0 && (
                                <div className="cites" style={{ marginTop: 6 }}>
                                  {assertion.citations.slice(0, 3).map((c, i) => (
                                    <span key={i} className="cite">{c.documentRef} p.{c.page}</span>
                                  ))}
                                </div>
                              )}
                              <div className="sg-acts">
                                <button className="go" onClick={() => {}}>Accept</button>
                                <button onClick={() => {}}>Override</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {advisory.summary?.status === 'abstained' && (
                      <p className="ai-absent">
                        Summary abstained: {advisory.summary.abstainReason ?? 'low confidence'}. Needs human review.
                      </p>
                    )}

                    {advisory.status === 'failed' && (
                      <p className="ai-absent">AI advisory analysis failed. Review manually.</p>
                    )}

                    <p style={{ fontSize: 11, color: 'var(--ink-mut)', marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
                      This is an advisory suggestion only. The final determination must be made by an authorized reviewer.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showApprove && (
        <QuickApproveModal
          onSubmit={(rationale) => { void handleApprove(rationale); }}
          onClose={() => setShowApprove(false)}
          pending={actionPending}
        />
      )}
    </div>
  );
}
