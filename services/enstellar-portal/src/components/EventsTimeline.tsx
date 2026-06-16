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
        <ol className="en-timeline">
          {events.map((ev, idx) => {
            const eventType =
              typeof ev['event_type'] === 'string' ? ev['event_type'] : 'unknown'
            const occurredAt =
              typeof ev['occurred_at'] === 'string'
                ? new Date(ev['occurred_at']).toLocaleString()
                : ''
            return (
              <li key={idx} className="en-timeline-item">
                <span className="ts">{occurredAt}</span>
                <span>{eventType.replace(/_/g, ' ')}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
