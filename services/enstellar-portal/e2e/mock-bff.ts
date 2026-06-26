/**
 * Minimal Express mock for the BFF — used by Playwright in CI.
 * Run with: npx tsx e2e/mock-bff.ts
 * Listens on PORT (default 8001).
 */
import http from 'node:http'

const CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const MD_CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
const PORT = parseInt(process.env.PORT ?? '8001', 10)

function respond(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(json)
}

const server = http.createServer((req, res) => {
  const url = req.url ?? ''

  // GET /bff/queues/:queueId/worklist
  if (req.method === 'GET' && url.includes('/worklist')) {
    respond(res, 200, {
      items: [
        {
          case_id: CASE_ID,
          member_name: 'Jane E2E',
          service_description: 'Office Visit',
          lob: 'commercial',
          status: 'clinical_review',
          urgency: 'standard',
          sla: { deadline: new Date(Date.now() + 20 * 3600 * 1000).toISOString(), hours_remaining: 20, rag: 'amber', paused: false },
        },
        {
          case_id: MD_CASE_ID,
          member_name: 'Dr Review Patient',
          service_description: 'MRI Lumbar Spine',
          lob: 'commercial',
          status: 'md_review',
          urgency: 'standard',
          sla: { deadline: new Date(Date.now() + 20 * 3600 * 1000).toISOString(), hours_remaining: 20, rag: 'amber', paused: false },
        },
      ],
      total: 2,
      page: 1,
      page_size: 25,
    })
    return
  }

  // GET /bff/cases/:caseId/criteria
  if (req.method === 'GET' && url.includes('/criteria')) {
    respond(res, 200, [
      {
        id: 'crit-01',
        criterion_id: 'C-01',
        text: 'Imaging modality is appropriate for the diagnosis',
        status: 'met',
        evidence: null,
        citations: [],
      },
      {
        id: 'crit-02',
        criterion_id: 'C-02',
        text: 'Medical necessity attestation from treating physician',
        status: 'gap',
        evidence: null,
        citations: [],
      },
      {
        id: 'crit-03',
        criterion_id: 'C-03',
        text: 'Conservative treatment documented for minimum 6 weeks',
        status: 'unknown',
        evidence: null,
        citations: [],
      },
    ])
    return
  }

  // GET /bff/cases/:caseId
  if (req.method === 'GET' && url.includes('/cases/') && !url.includes('/criteria') && !url.includes('/documents') && !url.includes('/suggestions') && !url.includes('/rfi') && !url.includes('/notice-preview')) {
    const isMdCase = url.includes(MD_CASE_ID)
    respond(res, 200, {
      case_id: isMdCase ? MD_CASE_ID : CASE_ID,
      tenant_id: 'tenant-e2e',
      status: isMdCase ? 'md_review' : 'clinical_review',
      urgency: 'standard',
      lob: 'commercial',
      member: { name: isMdCase ? 'Dr Review Patient' : 'Jane E2E', member_id: isMdCase ? 'MBR-MD' : 'MBR-E2E' },
      coverage: { plan_id: 'PLN-E2E' },
      service_lines: [{ procedure_code: isMdCase ? '72148' : '99213', procedure_description: isMdCase ? 'MRI Lumbar Spine' : 'Office Visit' }],
      events: [{ event_type: 'intake', occurred_at: '2026-06-01T00:00:00Z' }],
      sla: null,
    })
    return
  }

  // POST /bff/cases/:caseId/adverse-decision
  if (req.method === 'POST' && url.includes('/adverse-decision')) {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      if (!parsed.sign_off_confirmed) {
        respond(res, 400, { detail: 'sign_off_confirmed must be true' })
      } else {
        respond(res, 201, { signoff_id: 'mock-signoff-id', outcome: parsed.outcome })
      }
    })
    return
  }

  // POST /bff/cases/:caseId/decision
  if (req.method === 'POST' && url.includes('/decision')) {
    respond(res, 200, { status: 'approved' })
    return
  }

  // POST /bff/dtr/questionnaire-response
  if (req.method === 'POST' && url.includes('/bff/dtr/questionnaire-response')) {
    respond(res, 200, { resourceType: 'QuestionnaireResponse', id: 'qr-1' })
    return
  }

  // GET /bff/dtr/questionnaire
  if (req.method === 'GET' && url.includes('/bff/dtr/questionnaire')) {
    respond(res, 200, {
      resourceType: 'Questionnaire',
      id: 'dtr-svc-1',
      url: 'https://enstellar.simintero.com/Questionnaire/dtr-svc-1',
      status: 'active',
      item: [
        { linkId: 'indication', text: 'Clinical indication', type: 'string' },
        { linkId: 'tried-conservative', text: 'Conservative therapy attempted?', type: 'boolean' },
        { linkId: 'diagnosis', text: 'Primary diagnosis (ICD-10)', type: 'string' },
      ],
    })
    return
  }

  // POST /bff/crd/invoke
  if (req.method === 'POST' && url.includes('/bff/crd/invoke')) {
    respond(res, 200, [
      {
        summary: 'Prior authorization required for 72148',
        indicator: 'warning',
        detail: 'Launch DTR to complete documentation.',
        links: [
          {
            label: 'Complete documentation (DTR)',
            url: 'http://localhost:8080/dtr/launch',
            type: 'smart',
            appContext: '72148',
          },
        ],
      },
    ])
    return
  }

  // GET /bff/queues/:queueId/stats
  if (req.method === 'GET' && url.includes('/queues/') && url.includes('/stats')) {
    respond(res, 200, {
      ai_determinations: 0,
      adverse_human_signed_pct: 100.0,
      sla_compliance_expedited_pct: 96.0,
      period_start: '2026-06-01T00:00:00Z',
      period_end: '2026-06-30T23:59:59Z',
    })
    return
  }

  // GET /bff/cases/:caseId/documents
  if (req.method === 'GET' && url.includes('/cases/') && url.includes('/documents') && !url.includes('/content')) {
    respond(res, 200, [
      { id: 'doc-001', title: 'Referral note', url: '#', authored: '2026-06-02' },
      { id: 'doc-002', title: 'PT progress notes', url: '#', authored: '2026-01-12' },
    ])
    return
  }

  // GET /bff/documents/:id/content
  if (req.method === 'GET' && url.includes('/documents/') && url.includes('/content')) {
    respond(res, 200, {
      id: 'doc-001',
      title: 'Referral note',
      body: 'Patient referred for MRI lumbar spine.\nIndicating physician: Dr. M. Chen\nDiagnosis: M54.5 (low back pain)\nDate: 2026-06-02',
    })
    return
  }

  // GET /bff/cases/:caseId/suggestions
  if (req.method === 'GET' && url.includes('/cases/') && url.includes('/suggestions') && !url.includes('/action')) {
    respond(res, 200, [
      {
        id: 'sug-01',
        title: 'Criterion C-01 supported',
        body: 'Imaging modality is appropriate per submitted documentation.',
        confidence: 0.94,
        status: 'pending',
        citations: ['Policy §4.2.1'],
      },
    ])
    return
  }

  // POST /bff/cases/:caseId/suggestions/:id/action
  if (req.method === 'POST' && url.includes('/suggestions/') && url.includes('/action')) {
    respond(res, 200, {})
    return
  }

  // GET /bff/cases/:caseId/notice-preview
  if (req.method === 'GET' && url.includes('/notice-preview')) {
    respond(res, 200, {
      body: [
        'NOTICE OF ADVERSE DETERMINATION',
        '',
        'Member: Jane E2E  |  Member ID: MBR-E2E',
        'Date of Notice: 2026-06-26',
        'Service Requested: Office Visit (99213)',
        '',
        'DETERMINATION: DENIED',
        '',
        'We have reviewed your request for the above service and have determined',
        'that it does not meet medical necessity criteria at this time.',
        '',
        'Reason: Medical necessity attestation from treating physician not provided.',
        '',
        'You have the right to appeal this determination within 60 days.',
        'Contact: 1-800-ENSTELLAR | appeals@enstellar.simintero.com',
      ].join('\n'),
    })
    return
  }

  respond(res, 404, { detail: 'not found' })
})

server.listen(PORT, () => {
  console.log(`mock-bff listening on http://localhost:${PORT}`)
})
