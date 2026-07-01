import { Router } from 'express'
import type { Request, Response } from 'express'
import type { GovernanceStore } from '../store/GovernanceStore.js'

export interface VkasRollbackClient {
  rollback(canonicalUrl: string, version: string, reason: string, incidentRef?: string | null): Promise<void>
}

export interface RollbackInput {
  artifact_id: string
  version: string
  reason: string
  incident_ref?: string | null
}

export async function handleRollback(
  input: RollbackInput,
  store: GovernanceStore,
  vkasClient: VkasRollbackClient,
): Promise<{ status: number; body: unknown }> {
  const state = await store.get(input.artifact_id)
  if (state === undefined) {
    return { status: 404, body: { error: 'Artifact not found' } }
  }
  try {
    await vkasClient.rollback(input.artifact_id, input.version, input.reason, input.incident_ref ?? null)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('(409)')) {
      return { status: 409, body: { error: msg } }
    }
    throw err
  }
  return { status: 200, body: { rolled_back: true, artifact_id: input.artifact_id, version: input.version } }
}

export function createRollbackRouter(
  store: GovernanceStore,
  vkasClient: VkasRollbackClient,
): Router {
  const router = Router()
  router.post('/v1/governance/rollback', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>
    if (typeof body['artifact_id'] !== 'string') {
      res.status(400).json({ error: 'artifact_id is required' }); return
    }
    if (typeof body['version'] !== 'string') {
      res.status(400).json({ error: 'version is required' }); return
    }
    if (typeof body['reason'] !== 'string' || body['reason'].trim() === '') {
      res.status(400).json({ error: 'reason is required' }); return
    }
    try {
      const result = await handleRollback(
        {
          artifact_id: body['artifact_id'],
          version: body['version'],
          reason: body['reason'],
          incident_ref: typeof body['incident_ref'] === 'string' ? body['incident_ref'] : null,
        },
        store,
        vkasClient,
      )
      res.status(result.status).json(result.body)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })
  return router
}
