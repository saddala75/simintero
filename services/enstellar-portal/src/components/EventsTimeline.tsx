import type { CaseDetail } from '../types'

interface Props {
  events: CaseDetail['events']
}

export function EventsTimeline({ events }: Props) {
  return (
    <section data-testid="events-timeline">
      <h3>Events</h3>
      {events.length === 0 ? (
        <p>No events.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0 }}>
          {events.map((ev, idx) => {
            const eventType =
              typeof ev['event_type'] === 'string' ? ev['event_type'] : 'unknown'
            const occurredAt =
              typeof ev['occurred_at'] === 'string'
                ? new Date(ev['occurred_at']).toLocaleString()
                : ''
            return (
              <li
                key={idx}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex',
                  gap: 12,
                }}
              >
                <span style={{ color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {occurredAt}
                </span>
                <span>{eventType.replace(/_/g, ' ')}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
