import { Router } from 'express'
import type { Pool } from 'pg'

export function createActivationRouter(pool: Pool): Router {
  const router = Router()

  router.get('/v1/quality/measures/activation', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined
      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' })
        return
      }
      const { rows } = await pool.query<{ measure_ref: string }>(
        'SELECT measure_ref FROM qual.measure_activation WHERE tenant_id = $1',
        [tenantId],
      )
      res.json({ active: rows.map((r) => r.measure_ref) })
    } catch (err) { next(err) }
  })

  router.post('/v1/quality/measures/:measureRef/activate', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined
      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' })
        return
      }
      const { measureRef } = req.params
      await pool.query(
        `INSERT INTO qual.measure_activation (tenant_id, measure_ref)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [tenantId, measureRef],
      )
      res.json({ measure_ref: measureRef, active: true })
    } catch (err) { next(err) }
  })

  router.delete('/v1/quality/measures/:measureRef/activate', async (req, res, next) => {
    try {
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined
      if (!tenantId) {
        res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' })
        return
      }
      const { measureRef } = req.params
      await pool.query(
        'DELETE FROM qual.measure_activation WHERE tenant_id = $1 AND measure_ref = $2',
        [tenantId, measureRef],
      )
      res.json({ measure_ref: measureRef, active: false })
    } catch (err) { next(err) }
  })

  return router
}
