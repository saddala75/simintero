import { describe, it, expect } from 'vitest'

describe('keycloak auth module', () => {
  it('exports currentBearer function', async () => {
    const mod = await import('./keycloak')
    expect(typeof mod.currentBearer).toBe('function')
  })

  it('exports IS_MOCK flag', async () => {
    const mod = await import('./keycloak')
    expect(typeof mod.IS_MOCK).toBe('boolean')
  })
})
