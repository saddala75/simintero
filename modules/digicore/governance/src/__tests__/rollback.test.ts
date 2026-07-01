import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleRollback } from '../routes/rollback.js'
import type { RollbackInput, VkasRollbackClient } from '../routes/rollback.js'
import { InMemoryGovernanceStore } from '../store/InMemoryGovernanceStore.js'

describe('handleRollback', () => {
  let store: InMemoryGovernanceStore
  let vkasClient: VkasRollbackClient
  let rollbackSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = new InMemoryGovernanceStore()
    rollbackSpy = vi.fn().mockResolvedValue(undefined)
    vkasClient = { rollback: rollbackSpy }
  })

  it('rolls back an existing artifact and returns 200', async () => {
    await store.submit({ artifactId: 'artifact-1', createdBy: 'author-1' })
    const input: RollbackInput = { artifact_id: 'artifact-1', version: '1.0.0', reason: 'broken release' }
    const result = await handleRollback(input, store, vkasClient)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ rolled_back: true, artifact_id: 'artifact-1', version: '1.0.0' })
    expect(rollbackSpy).toHaveBeenCalledWith('artifact-1', '1.0.0', 'broken release', null)
  })

  it('returns 404 when artifact is not in the store', async () => {
    const input: RollbackInput = { artifact_id: 'nonexistent', version: '1.0.0', reason: 'test' }
    const result = await handleRollback(input, store, vkasClient)
    expect(result.status).toBe(404)
    expect(rollbackSpy).not.toHaveBeenCalled()
  })

  it('returns 409 when VKAS signals a conflict', async () => {
    await store.submit({ artifactId: 'artifact-2', createdBy: 'author-1' })
    rollbackSpy.mockRejectedValue(new Error('VKAS rollback failed (409) for artifact-2@1.0.0'))
    const input: RollbackInput = { artifact_id: 'artifact-2', version: '1.0.0', reason: 'test' }
    const result = await handleRollback(input, store, vkasClient)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: expect.stringContaining('409') })
  })

  it('passes incident_ref to VKAS when provided', async () => {
    await store.submit({ artifactId: 'artifact-3', createdBy: 'author-1' })
    const input: RollbackInput = { artifact_id: 'artifact-3', version: '2.0.0', reason: 'incident', incident_ref: 'INC-9999' }
    const result = await handleRollback(input, store, vkasClient)
    expect(result.status).toBe(200)
    expect(rollbackSpy).toHaveBeenCalledWith('artifact-3', '2.0.0', 'incident', 'INC-9999')
  })
})
