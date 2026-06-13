interface Citation {
  documentRef: string;
  page: number;
  region: number[];
  excerptHash: string;
}

interface Assertion {
  id: string;
  text: string;
  citations: Citation[];
  confidence: number;
}

interface SummaryBlock {
  status: 'ok' | 'abstained';
  assertions?: Assertion[];
  abstainReason?: string | null;
}

interface TriageBlock {
  status: 'ok' | 'abstained';
  suggestion?: 'likely_meets' | 'needs_rfi' | 'route_to_clinician';
  confidence?: number;
}

interface AdvisoryResult {
  analysisId: string;
  classification: 'advisory';
  status: 'complete' | 'partial' | 'failed';
  summary?: SummaryBlock;
  triage?: TriageBlock;
  abstentions?: Array<{ block: string; reason: string }>;
}

interface AdvisoryPanelProps {
  advisory: AdvisoryResult | null | undefined;
  onFeedback?: (target: string, action: string) => void;
}

const TRIAGE_LABELS: Record<string, string> = {
  likely_meets: 'Likely meets criteria',
  needs_rfi: 'Additional information needed',
  route_to_clinician: 'Route to clinician for review',
};

export function AdvisoryPanel({ advisory, onFeedback }: AdvisoryPanelProps) {
  if (!advisory) {
    return (
      <div className="advisory-panel advisory-panel--not-available">
        <p className="advisory-panel__status">AI advisory not available for this case.</p>
      </div>
    );
  }

  if (advisory.status === 'failed') {
    return (
      <div className="advisory-panel advisory-panel--failed">
        <p>AI advisory analysis failed. Please review manually.</p>
      </div>
    );
  }

  const partialBanner = advisory.status === 'partial' && (
    <div className="advisory-panel__partial-banner" role="alert">
      AI analysis incomplete — some sections unavailable. Human review required.
    </div>
  );

  const abstentionBanners = (advisory.abstentions ?? []).map(a => (
    <div key={a.block} className="advisory-panel__abstention" role="note">
      <strong>{a.block}</strong>: Needs human review — {a.reason}
    </div>
  ));

  return (
    <div className="advisory-panel" data-classification="advisory">
      {partialBanner}
      {abstentionBanners}

      {advisory.triage?.status === 'ok' && advisory.triage.suggestion && (
        <div className="advisory-panel__triage">
          <h3>AI Triage Suggestion</h3>
          <p className={`advisory-panel__suggestion advisory-panel__suggestion--${advisory.triage.suggestion}`}>
            {TRIAGE_LABELS[advisory.triage.suggestion]}
          </p>
          {advisory.triage.confidence !== undefined && (
            <span className="advisory-panel__confidence">
              Confidence: {Math.round(advisory.triage.confidence * 100)}%
            </span>
          )}
          <p className="advisory-panel__advisory-notice">
            This is an advisory suggestion only. The final determination must be made by an authorized reviewer.
          </p>
        </div>
      )}

      {advisory.summary?.status === 'ok' && (advisory.summary.assertions ?? []).length > 0 && (
        <div className="advisory-panel__summary">
          <h3>Summary</h3>
          {(advisory.summary.assertions ?? []).map(assertion => (
            <div key={assertion.id} className="advisory-panel__assertion">
              <p className="advisory-panel__assertion-text">{assertion.text}</p>
              <ul className="advisory-panel__citations">
                {assertion.citations.map((c, i) => (
                  <li key={i} className="advisory-panel__citation">
                    Source: {c.documentRef}, page {c.page}
                  </li>
                ))}
              </ul>
              {onFeedback && (
                <div className="advisory-panel__assertion-actions">
                  <button onClick={() => onFeedback(`assertion:${assertion.id}`, 'accepted')}>Accept</button>
                  <button onClick={() => onFeedback(`assertion:${assertion.id}`, 'overridden')}>Override</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {advisory.summary?.status === 'abstained' && (
        <div className="advisory-panel__abstention">
          Summary abstained: {advisory.summary.abstainReason ?? 'low confidence'}. Needs human review.
        </div>
      )}
    </div>
  );
}
