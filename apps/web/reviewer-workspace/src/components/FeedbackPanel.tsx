import { useState } from 'react';

interface FeedbackPanelProps {
  analysisId: string;
  onSubmit: (items: Array<{ target: string; action: string; reasonCode?: string }>) => Promise<void>;
}

export function FeedbackPanel({ analysisId: _analysisId, onSubmit }: FeedbackPanelProps) {
  const [pending, setPending] = useState<Array<{ target: string; action: string; reasonCode?: string }>>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (pending.length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(pending);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return <div className="feedback-panel feedback-panel--submitted">Feedback submitted. Thank you.</div>;
  }

  return (
    <div className="feedback-panel">
      <h3>Reviewer Feedback</h3>
      {pending.length > 0 && (
        <ul className="feedback-panel__items">
          {pending.map((item, i) => (
            <li key={i}>{item.target}: {item.action}{item.reasonCode ? ` (${item.reasonCode})` : ''}</li>
          ))}
        </ul>
      )}
      <button
        className="feedback-panel__submit"
        onClick={handleSubmit}
        disabled={submitting || pending.length === 0}
      >
        {submitting ? 'Submitting...' : 'Submit Feedback'}
      </button>
    </div>
  );
}

export function useFeedbackCapture() {
  const [items, setItems] = useState<Array<{ target: string; action: string; reasonCode?: string }>>([]);
  const capture = (target: string, action: string, reasonCode?: string) => {
    setItems(prev => [...prev.filter(i => i.target !== target), { target, action, reasonCode }]);
  };
  return { items, capture };
}
