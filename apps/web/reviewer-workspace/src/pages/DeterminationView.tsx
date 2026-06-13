import { useState, useCallback } from 'react';
import type { DeterminationOutcome } from '../types.js';
import { useCaseDetail } from '../hooks/useCaseDetail.js';
import { useRulesTrace } from '../hooks/useRulesTrace.js';
import { useAdvisory } from '../hooks/useAdvisory.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { RECORD_DECISION_MUTATION } from '../graphql/mutations.js';

interface DeterminationViewProps {
  caseId: string;
  onBack: () => void;
}

type DetOutcome = 'denied' | 'partial' | 'modified';

const REASON_CODES = [
  { code: 'NCR-001', label: 'Not medically necessary' },
  { code: 'NCR-002', label: 'Criteria not met' },
  { code: 'NCR-003', label: 'Alternative treatment available' },
  { code: 'NCR-004', label: 'Experimental / investigational' },
  { code: 'NCR-005', label: 'Insufficient clinical information' },
  { code: 'NCR-006', label: 'Benefit limitation' },
  { code: 'NCR-007', label: 'Prior authorization not obtained' },
];

function shortId(id: string) { return id.slice(-8).toUpperCase(); }

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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

interface GateStep { label: string; done: boolean; }

function GateColumn({ steps, onIssue, issuing }: { steps: GateStep[]; onIssue: () => void; issuing: boolean }) {
  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;

  return (
    <div style={{ padding: 18 }}>
      <div className="gate-card">
        <div className="gate-h">
          <div className="gt">Sign-off Gate</div>
          <div className="gs">All steps required before issue</div>
          <div className="progress">
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="gate-b">
          {steps.map((s, i) => (
            <div key={i} className={`chk ${s.done ? 'done' : ''}`}>
              <div className="box">
                {s.done && <CheckIcon />}
              </div>
              <span className="ct">{s.label}</span>
            </div>
          ))}

          <button
            className="gate-issue-btn"
            disabled={!allDone || issuing}
            onClick={onIssue}
          >
            {issuing ? (
              <>
                <div className="spin" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                Issuing…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2L3 5v4c0 3 5 5 5 5s5-2 5-5V5L8 2z" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                Issue Determination
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeterminationView({ caseId, onBack }: DeterminationViewProps) {
  const ctx = useSimCtx();
  const { caseDetail, loading, error } = useCaseDetail(caseId);
  const { criteria } = useRulesTrace(caseId);
  const { advisory } = useAdvisory(caseId);

  const [outcome, setOutcome] = useState<DetOutcome | ''>('');
  const [reasonCode, setReasonCode] = useState('');
  const [rationale, setRationale] = useState('');
  const [citations, setCitations] = useState<string[]>([]);
  const [attested, setAttested] = useState(false);
  const [issued, setIssued] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const gapCriteria = criteria.filter(c => c.result === false);

  const steps: GateStep[] = [
    { label: 'Determination type selected', done: outcome !== '' },
    { label: 'Criteria findings reviewed', done: gapCriteria.length === 0 || outcome !== '' },
    { label: 'Reason code selected', done: reasonCode !== '' },
    { label: 'Citations added', done: citations.length > 0 },
    { label: 'Clinical rationale written', done: rationale.trim().length >= 20 },
    { label: 'Clinician attestation', done: attested },
  ];

  const draftFromAdvisory = useCallback(() => {
    if (!advisory?.summary?.assertions?.length) return;
    const draft = advisory.summary.assertions.map(a => a.text).join('\n\n');
    setRationale(prev => prev ? prev + '\n\n' + draft : draft);
  }, [advisory]);

  const addCitation = (code: string) => {
    if (!citations.includes(code)) setCitations(prev => [...prev, code]);
  };

  const removeCitation = (code: string) => {
    setCitations(prev => prev.filter(c => c !== code));
  };

  const handleIssue = useCallback(async () => {
    if (!steps.every(s => s.done)) return;
    setActionError(null);
    setActionPending(true);
    try {
      const gqlOutcome: DeterminationOutcome =
        outcome === 'denied' ? 'denied' :
        outcome === 'partial' ? 'partial' : 'modified';

      const data = await gqlRequest<{
        recordDecision: { determinationId: string | null; error: string | null; errorCode: string | null };
      }>(
        RECORD_DECISION_MUTATION,
        { input: { caseId, outcome: gqlOutcome, rationale: rationale.trim() } },
        ctx,
      );
      if (data.recordDecision.error) {
        setActionError(data.recordDecision.error);
      } else {
        setIssued(true);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [steps, outcome, caseId, rationale, ctx]);

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
          <button className="back-link" style={{ marginTop: 12 }} onClick={onBack}>← Back to case review</button>
        </div>
      </div>
    );
  }

  if (issued) {
    return (
      <div className="case-shell">
        <div className="case-area" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div style={{ textAlign: 'center', maxWidth: 440 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--ok-tint)', border: '1.5px solid var(--ok)', display: 'grid', placeItems: 'center', margin: '0 auto 20px', color: 'var(--ok)' }}>
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
                <path d="M5 13l5 5 11-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 24, margin: '0 0 10px', letterSpacing: '-.02em' }}>
              Determination Issued
            </h2>
            <p style={{ color: 'var(--ink-mut)', fontSize: 14, margin: '0 0 24px' }}>
              The {outcome} determination for PA-{shortId(caseId)} has been recorded and signed by an authorized medical director.
            </p>
            <button className="act primary" onClick={onBack}>Return to case</button>
          </div>
        </div>
      </div>
    );
  }

  const aiAssertion = advisory?.summary?.assertions?.[0];

  return (
    <div className="case-shell">
      <div className="case-area">
        {/* Command Bar */}
        <div className="cmd">
          <button className="railtoggle" onClick={onBack} title="Back to case review" aria-label="Back to case review">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="cmd-id">
            <div className="top">
              <span className="cid">PA-{shortId(caseDetail.case_id)}</span>
              <span className={`pri-badge ${caseDetail.urgency === 'expedited' ? '' : 'std'}`}>
                {caseDetail.urgency}
              </span>
              <span className="state-chip" style={{ background: 'var(--amber-tint)', color: 'var(--amber)', border: '1px solid rgba(181,120,14,.3)' }}>
                Pending Determination
              </span>
            </div>
            <div className="sub">
              LOB: <b>{caseDetail.lob}</b>
              {caseDetail.member_ref && <> · Member: <b>{caseDetail.member_ref}</b></>}
              {' · '}<span style={{ color: 'var(--red)', fontWeight: 600 }}>MD sign-off required</span>
            </div>
          </div>

          <div className="clock-box">
            <div className="clock-lbl">Decision clock</div>
            <div className="clock-val" style={{ color: 'var(--amber)' }}>—:——</div>
          </div>
        </div>

        {actionError && (
          <div className="alert-bar" style={{ margin: '0 20px 0', borderRadius: 0, borderLeft: 0, borderRight: 0 }} role="alert">
            {actionError}
          </div>
        )}

        {/* 3-Column Content */}
        <div className="det-content">
          {/* Context column */}
          <div className="col ctx">
            <div className="panel">
              <div className="panel-h">
                <span className="pt">Member &amp; Coverage</span>
              </div>
              <div className="panel-b">
                <div className="kv"><span className="k">Member</span><span className="v">{caseDetail.member_ref || '—'}</span></div>
                <div className="kv"><span className="k">Line of business</span><span className="v">{caseDetail.lob}</span></div>
                <div className="kv"><span className="k">Urgency</span><span className="v" style={{ color: caseDetail.urgency === 'expedited' ? 'var(--red)' : 'var(--ink)' }}>{caseDetail.urgency}</span></div>
                <div className="kv"><span className="k">Current state</span><span className="v">{stateLabel(caseDetail.state)}</span></div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <span className="pt">Requested Services</span>
              </div>
              <div className="panel-b">
                {caseDetail.service_lines.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--ink-mut)', fontSize: 13 }}>No service lines on file.</p>
                ) : (
                  caseDetail.service_lines.map(line => (
                    <div key={line.line_id} className="svcline">
                      <div className="code">{line.code.code}</div>
                      <div className="name">Qty: {line.qty}</div>
                      <div className="meta">{line.status}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {gapCriteria.length > 0 && (
              <div className="panel">
                <div className="panel-h">
                  <span className="pt" style={{ color: 'var(--amber)' }}>Criteria Gaps</span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'var(--amber)', background: 'var(--amber-tint)', borderRadius: 999, padding: '2px 8px' }}>{gapCriteria.length}</span>
                </div>
                <div className="panel-b">
                  {gapCriteria.map((c, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                      <div style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 11, fontFamily: '"JetBrains Mono",monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>✗ Not met</div>
                      <div style={{ fontWeight: 600, marginTop: 2 }}>{c.expression_name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Work column */}
          <div className="col work">
            <div className="work-head-det">
              <h2>Adverse Determination</h2>
              <div className="policy-pin" style={{ marginTop: 8 }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2L3 5v4c0 3 5 5 5 5s5-2 5-5V5L8 2z" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                <b>MD authorization required</b> · {(ctx.roles as string[]).includes('medical_director') ? 'Authorized' : 'Unauthorized role'}
              </div>
            </div>

            {/* Step 1: Type */}
            <div className={`section ${outcome ? '' : ''}`}>
              <div className="sec-h">
                <span className={`sn ${outcome ? 'done' : ''}`}>{outcome ? '✓' : '1'}</span>
                <span className="st">Determination Type</span>
                <span className={`req ${outcome ? 'done' : ''}`}>{outcome ? 'Done' : 'Required'}</span>
              </div>
              <div className="sec-b">
                <div className="types">
                  {([
                    ['denied',  'Deny',         'Full denial — criteria not met'],
                    ['partial', 'Partial Deny', 'Some service lines denied'],
                    ['modified','Modify',        'Approve modified service'],
                  ] as [DetOutcome, string, string][]).map(([val, label, desc]) => (
                    <button
                      key={val}
                      className={`type ${outcome === val ? 'sel' : ''}`}
                      onClick={() => setOutcome(val)}
                    >
                      <div className="tn">{label}</div>
                      <div className="td">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 2: Reason Code */}
            <div className={`section ${!outcome ? 'locked' : ''}`}>
              <div className="sec-h">
                <span className={`sn ${reasonCode ? 'done' : ''}`}>{reasonCode ? '✓' : '2'}</span>
                <span className="st">Reason Code</span>
                <span className={`req ${reasonCode ? 'done' : ''}`}>{reasonCode ? 'Done' : 'Required'}</span>
              </div>
              <div className="sec-b">
                <select
                  className="det-select"
                  value={reasonCode}
                  onChange={e => setReasonCode(e.target.value)}
                >
                  <option value="">— Select reason code —</option>
                  {REASON_CODES.map(r => (
                    <option key={r.code} value={r.code}>{r.code} · {r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Step 3: Citations */}
            <div className={`section ${!reasonCode ? 'locked' : ''}`}>
              <div className="sec-h">
                <span className={`sn ${citations.length > 0 ? 'done' : ''}`}>{citations.length > 0 ? '✓' : '3'}</span>
                <span className="st">Clinical Citations</span>
                <span className={`req ${citations.length > 0 ? 'done' : ''}`}>{citations.length > 0 ? 'Done' : 'Required'}</span>
              </div>
              <div className="sec-b">
                <p style={{ color: 'var(--ink-mut)', fontSize: 12.5, margin: '0 0 10px' }}>
                  Add clinical guidelines that support this determination.
                </p>
                <div className="chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {citations.map(code => (
                    <button
                      key={code}
                      onClick={() => removeCitation(code)}
                      style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--pine)', background: 'var(--pine-tint)', color: 'var(--pine)', display: 'inline-flex', alignItems: 'center', gap: 7 }}
                    >
                      {code} ×
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['MCG-2024-A1', 'InterQual-2024', 'CMS-LCD-L38069', 'ACOG-Practice-787', 'AHA-2023-CP'].map(c => (
                    citations.includes(c) ? null : (
                      <button
                        key={c}
                        onClick={() => addCitation(c)}
                        style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, padding: '7px 12px', borderRadius: 999, border: '1px dashed var(--line-2)', background: 'var(--panel-2)', color: 'var(--ink-mut)', display: 'inline-flex', alignItems: 'center', gap: 7 }}
                      >
                        + {c}
                      </button>
                    )
                  ))}
                </div>
              </div>
            </div>

            {/* Step 4: Clinical Rationale */}
            <div className={`section ${!citations.length ? 'locked' : ''}`}>
              <div className="sec-h">
                <span className={`sn ${rationale.trim().length >= 20 ? 'done' : ''}`}>
                  {rationale.trim().length >= 20 ? '✓' : '4'}
                </span>
                <span className="st">Clinical Rationale</span>
                <span className={`req ${rationale.trim().length >= 20 ? 'done' : ''}`}>
                  {rationale.trim().length >= 20 ? 'Done' : 'Required'}
                </span>
              </div>
              <div className="sec-b">
                <textarea
                  className="det-textarea"
                  rows={5}
                  placeholder="Document your clinical rationale for this adverse determination…"
                  value={rationale}
                  onChange={e => setRationale(e.target.value)}
                />
                {aiAssertion && !rationale && (
                  <button
                    onClick={draftFromAdvisory}
                    style={{ marginTop: 9, fontSize: 11.5, fontWeight: 600, color: 'var(--pine)', background: 'var(--pine-tint)', border: '1px solid rgba(15,86,76,.25)', borderRadius: 8, padding: '7px 11px', display: 'inline-flex', alignItems: 'center', gap: 7 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M5.5 8.5c.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    Draft from AI advisory
                  </button>
                )}
                <p style={{ fontSize: 11, color: 'var(--ink-mut)', marginTop: 8 }}>
                  Advisory-drafted content must be reviewed and affirmed by the MD before sign-off.
                </p>
              </div>
            </div>

            {/* Step 5: Sign-off */}
            <div className={`section ${rationale.trim().length < 20 ? 'locked' : ''}`}>
              <div className="sec-h">
                <span className={`sn ${attested ? 'done' : ''}`}>{attested ? '✓' : '5'}</span>
                <span className="st">Clinician Sign-off</span>
                <span className={`req ${attested ? 'done' : ''}`}>{attested ? 'Done' : 'Required'}</span>
              </div>
              <div className="sec-b">
                <div className="attest">
                  <input
                    type="checkbox"
                    id="attest-chk"
                    checked={attested}
                    onChange={e => setAttested(e.target.checked)}
                  />
                  <label htmlFor="attest-chk">
                    I attest that I have reviewed the clinical information for this case, the criteria findings above are accurate, and this determination is clinically appropriate and compliant with applicable guidelines. I understand this record cannot be altered after submission.
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Gate column */}
          <div className="col gate">
            <GateColumn steps={steps} onIssue={() => { void handleIssue(); }} issuing={actionPending} />
          </div>
        </div>
      </div>
    </div>
  );
}
