// services/qualitron-reporting/src/server.ts
import '@sim/otel'
import express from 'express'
import pg from 'pg'
import { createMeasuresRouter, createGapsRouter } from '@sim/qualitron-reporting'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] })
const app = express()
app.use(express.json())
app.use(createMeasuresRouter(pool))
app.use(createGapsRouter(pool))
app.get('/health', (_req, res) => res.json({ ok: true }))

const port = parseInt(process.env['PORT'] ?? '4080', 10)
app.listen(port, () => console.log(`qualitron-reporting listening on ${port}`))
