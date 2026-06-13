import { useState, useEffect } from 'react';
import { supportConsoleClient, CaseEvent } from '../api/supportConsoleClient.js';

interface Props {
  caseId: string;
  sessionToken: string;
}

export default function CaseTimeline({ caseId, sessionToken }: Props) {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supportConsoleClient.getCaseTimeline(caseId, sessionToken).then((evts) => {
      const sorted = [...evts].sort((a, b) =>
        a.occurred_at.localeCompare(b.occurred_at),
      );
      setEvents(sorted);
    });
  }, [caseId, sessionToken]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div>
      <h2>Case Timeline</h2>
      <ul>
        {events.map((event) => (
          <li key={event.event_id}>
            <button
              onClick={() => toggleExpand(event.event_id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span>{event.event_type}</span>
              <span> | </span>
              <span>{event.occurred_at}</span>
            </button>
            {expandedIds.has(event.event_id) && (
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
