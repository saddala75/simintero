import type { CaseDetail } from '../types'

interface Props {
  serviceLines: CaseDetail['service_lines']
}

export function ServiceLinesPanel({ serviceLines }: Props) {
  return (
    <section data-testid="service-lines-panel">
      <h3>Service Lines</h3>
      {serviceLines.length === 0 ? (
        <p>No service lines.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {serviceLines.map((sl, idx) => {
            const code =
              typeof sl['procedure_code'] === 'string' ? sl['procedure_code'] : '—'
            const desc =
              typeof sl['procedure_description'] === 'string'
                ? sl['procedure_description']
                : '—'
            return (
              <li
                key={idx}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <strong>{code}</strong> — {desc}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
