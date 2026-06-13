import type { TraceCriterion } from '../types.js';

interface RulesTracePanelProps {
  criteria: TraceCriterion[];
}

function ResultIndicator({ result }: { result: boolean | 'indeterminate' }) {
  if (result === true) {
    return (
      <span className="trace-criterion__result trace-criterion__result--met" aria-label="met">
        ✓
      </span>
    );
  }
  if (result === false) {
    return (
      <span className="trace-criterion__result trace-criterion__result--not-met" aria-label="not met">
        ✗
      </span>
    );
  }
  return (
    <span className="trace-criterion__result trace-criterion__result--indeterminate" aria-label="indeterminate">
      ?
    </span>
  );
}

export function RulesTracePanel({ criteria }: RulesTracePanelProps) {
  if (criteria.length === 0) {
    return <p className="rules-trace-panel__empty">No criteria available.</p>;
  }

  return (
    <ul className="rules-trace-panel">
      {criteria.map((criterion, index) => (
        <li key={`${criterion.expression_name}-${index}`} className="trace-criterion">
          <div className="trace-criterion__header">
            <ResultIndicator result={criterion.result} />
            <span className="trace-criterion__name">{criterion.expression_name}</span>
          </div>
          <div className="trace-criterion__artifact">
            <span className="trace-criterion__artifact-url">
              {criterion.artifact_canonical_url}
            </span>
            <span className="trace-criterion__artifact-version">
              v{criterion.artifact_version}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
