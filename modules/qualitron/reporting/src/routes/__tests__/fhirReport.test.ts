import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Pool } from 'pg'

// We test only the new endpoint added to createMeasuresRouter
const FHIR_REPORT = {
  resourceType: 'MeasureReport',
  type: 'summary',
  status: 'complete',
}

function makePool(reportFhir: object | null) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('report_type')) {
        return Promise.resolve({
          rows: reportFhir ? [{ report_fhir: reportFhir }] : [],
        })
      }
      return Promise.resolve({ rows: [] })
    }),
  } as unknown as Pool
}

async function buildApp(pool: Pool) {
  const { createMeasuresRouter } = await import('../measures.js')
  const app = express()
  app.use(express.json())
  app.use(createMeasuresRouter(pool))
  return app
}

describe('GET /v1/quality/measures/:ref/runs/:runId/report', () => {
  it('returns FHIR summary MeasureReport as application/fhir+json', async () => {
    const app = await buildApp(makePool(FHIR_REPORT))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-01/report')
      .set('x-sim-tenant-id', 'tenant-dev')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/)
    expect(res.body['resourceType']).toBe('MeasureReport')
    expect(res.body['type']).toBe('summary')
  })

  it('returns 404 when no summary report exists', async () => {
    const app = await buildApp(makePool(null))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-99/report')
      .set('x-sim-tenant-id', 'tenant-dev')
    expect(res.status).toBe(404)
  })

  it('returns 401 when tenant header is missing', async () => {
    const app = await buildApp(makePool(FHIR_REPORT))
    const res = await request(app)
      .get('/v1/quality/measures/hedis:BCS-E/runs/run-01/report')
    expect(res.status).toBe(401)
  })
})
