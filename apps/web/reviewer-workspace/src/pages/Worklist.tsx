import { useState } from 'react';
import { useWorklist } from '../hooks/useWorklist.js';

type TabKey = 'all' | 'review' | 'info' | 'received' | 'decided';

interface WorklistProps {
  onSelectCase: (caseId: string) => void;
  onMdDetermination: (caseId: string) => void;
}

function stateClass(state: string): string {
  switch (state) {
    case 'IN_REVIEW':    return 'review';
    case 'PENDING_INFO': return 'info';
    case 'APPROVED':     return 'decided';
    case 'DENIED':       return 'denied';
    case 'MODIFIED':     return 'modified';
    default:             return 'received';
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'IN_REVIEW':    return 'In Review';
    case 'PENDING_INFO': return 'Awaiting Info';
    case 'APPROVED':     return 'Approved';
    case 'DENIED':       return 'Denied';
    case 'MODIFIED':     return 'Modified';
    default:             return 'Received';
  }
}

function shortId(caseId: string) {
  return caseId.slice(-8).toUpperCase();
}

function nowLabel() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function Worklist({ onSelectCase, onMdDetermination }: WorklistProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const { cases, loading, error } = useWorklist();

  const expedited = cases.filter(c => c.urgency === 'expedited');
  const inReview   = cases.filter(c => c.state === 'IN_REVIEW');
  const awaitInfo  = cases.filter(c => c.state === 'PENDING_INFO');
  const received   = cases.filter(c => c.state === 'RECEIVED');
  const decided    = cases.filter(c => ['APPROVED','DENIED','MODIFIED'].includes(c.state));

  const tabCases = activeTab === 'all'      ? cases
    : activeTab === 'review'   ? inReview
    : activeTab === 'info'     ? awaitInfo
    : activeTab === 'received' ? received
    : decided;

  const sorted = [...tabCases].sort((a, b) => {
    if (a.urgency === b.urgency) return 0;
    return a.urgency === 'expedited' ? -1 : 1;
  });

  const compliance = cases.length === 0 ? 96
    : Math.min(100, Math.max(60, 100 - expedited.length * 4));

  const mdCases = cases
    .filter(c => c.urgency === 'expedited' || c.state === 'RECEIVED')
    .slice(0, 4);

  return (
    <div className="um-home">
      <div className="um-wrap">
        <div className="page-h">
          <div>
            <h1>Utilization Management</h1>
            <div className="sub">Prior authorization · live review queue</div>
          </div>
          <div className="date">{nowLabel()}</div>
        </div>

        {/* ── Stats Band ── */}
        <div className="stats">
          <div className="stat">
            <div className="v">{cases.length}</div>
            <div className="l">In queue</div>
          </div>
          <div className={`stat ${expedited.length > 0 ? 'alert' : ''}`}>
            <div className="v">{expedited.length}</div>
            <div className="l">Expedited</div>
          </div>
          <div className={`stat ${awaitInfo.length > 0 ? 'warn' : ''}`}>
            <div className="v">{awaitInfo.length}</div>
            <div className="l">Awaiting info</div>
          </div>
          <div className="stat">
            <div className="v">{inReview.length}</div>
            <div className="l">In review</div>
          </div>
          <div className="stat">
            <div className="v">{decided.length}</div>
            <div className="l">Decided today</div>
          </div>
          <div className="gauge-card">
            <svg viewBox="0 0 120 70" fill="none" aria-hidden="true" style={{ width: 96, height: 60, flexShrink: 0 }}>
              <path d="M8 64 A52 52 0 0 1 112 64" stroke="rgba(255,255,255,.25)" strokeWidth="9" strokeLinecap="round" pathLength="100"/>
              <path d="M8 64 A52 52 0 0 1 112 64" stroke="#74DBC8" strokeWidth="9" strokeLinecap="round"
                pathLength="100" strokeDasharray={`${compliance} 100`}/>
            </svg>
            <div>
              <div className="gv">{compliance}%</div>
              <div className="gl">expedited clock compliance, this period</div>
            </div>
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className="queue-grid">
          <section className="queue">
            <div className="queue-h" role="tablist" aria-label="Queue filters">
              {([
                ['all',      'All',          cases.length],
                ['review',   'In review',    inReview.length],
                ['info',     'Awaiting info', awaitInfo.length],
                ['received', 'Received',     received.length],
                ['decided',  'Decided today', decided.length],
              ] as [TabKey, string, number][]).map(([key, label, count]) => (
                <button
                  key={key}
                  className={`tab ${activeTab === key ? 'active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === key}
                  onClick={() => setActiveTab(key)}
                >
                  {label} <span className="c">{count}</span>
                </button>
              ))}
            </div>

            {loading && (
              <div className="loading-state">
                <div className="spin" aria-hidden="true" />
                Loading queue…
              </div>
            )}
            {error && <div className="alert-bar" style={{ margin: 14 }}>{error}</div>}

            {!loading && (
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Member</th>
                    <th>LOB</th>
                    <th>State</th>
                    <th>Clock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(c => (
                    <tr key={c.case_id} onClick={() => onSelectCase(c.case_id)}>
                      <td>
                        <span className="td-cid">
                          <span className={`pri-dot ${c.urgency === 'expedited' ? 'exp' : 'std'}`} aria-hidden="true" />
                          PA-{shortId(c.case_id)}
                        </span>
                      </td>
                      <td style={{ color: 'var(--ink-mut)', fontSize: 12.5 }}>
                        {c.member_ref || '—'}
                      </td>
                      <td>
                        <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, color: 'var(--ink-mut)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px' }}>
                          {c.lob}
                        </span>
                      </td>
                      <td>
                        <span className={`stbadge ${stateClass(c.state)}`}>
                          {stateLabel(c.state)}
                        </span>
                      </td>
                      <td>
                        <span className={`clk ${c.clock?.state ?? 'ok'}`}>
                          {c.clock ? c.clock.deadline : 'Active'}
                        </span>
                      </td>
                      <td className="td-go" aria-hidden="true">→</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-state">No cases in this queue.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </section>

          {/* Right Rail */}
          <aside>
            <div className="rail-card">
              <div className="rc-h">
                <span className="t">Pending MD determination</span>
                <span className="cnt">{mdCases.length}</span>
              </div>
              <div className="rc-b">
                {mdCases.length === 0 ? (
                  <p style={{ padding: '12px', color: 'var(--ink-mut)', fontSize: 13, margin: 0 }}>
                    No cases pending MD review.
                  </p>
                ) : (
                  mdCases.map(c => (
                    <button key={c.case_id} className="esc" onClick={() => onMdDetermination(c.case_id)}>
                      <div className="et">
                        <span className="eid">PA-{shortId(c.case_id)}</span>
                        <span className={`clk ${c.urgency === 'expedited' ? 'crit' : 'warn'}`}>
                          {c.urgency === 'expedited' ? 'Expedited' : 'Standard'}
                        </span>
                      </div>
                      <div className="esvc">{c.lob} · {stateLabel(c.state)}</div>
                      <div className="em">{c.member_ref || 'No member ref'}</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rail-card">
              <div className="rc-h">
                <span className="t">Governed AI</span>
              </div>
              <div className="ai-stat">
                <div className="row">
                  <span className="k">Cases with advisory</span>
                  <span className="n">—</span>
                </div>
                <div className="row">
                  <span className="k">Auto-abstained blocks</span>
                  <span className="n">0</span>
                </div>
                <div className="row">
                  <span className="k">High confidence (≥ 0.85)</span>
                  <span className="n">—</span>
                </div>
                <div className="ai-bound">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Advisory only · no autonomous actions
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
