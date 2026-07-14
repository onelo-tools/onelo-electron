import { describe, it, expect, vi, beforeEach } from 'vitest'

// onSessionChange is now multi-listener + returns an unsubscribe (parity with JS
// onAuthStateChange / Swift Combine currentSession — was a single slot that
// silently overwrote a prior registration). Payload stays `userId | null`.

const storage = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
}
vi.mock('./storage', () => ({ SecureTokenStorage: vi.fn().mockImplementation(() => storage) }))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockReturnValue('inst-1') }))

const httpPost = vi.fn()
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: { tenant_id: 't1', allow_custom_branding: false } }),
    httpPost: (...a: unknown[]) => httpPost(...(a as [])),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth(): OneloElectronAuth {
  return new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
}

describe('onSessionChange multi-listener + unsubscribe', () => {
  beforeEach(() => {
    httpPost.mockReset().mockResolvedValue({ status: 204, json: {} })
    storage.get.mockReset().mockResolvedValue('atok') // an access token so signOut posts revoke
    storage.clear.mockReset().mockResolvedValue(undefined)
  })

  it('fires ALL registered listeners (not just the last — the old single-slot bug)', async () => {
    const auth = makeAuth()
    const l1 = vi.fn(); const l2 = vi.fn()
    auth.onSessionChange(l1)
    auth.onSessionChange(l2)
    await auth.signOut() // fires _notifySessionChange(null)
    expect(l1).toHaveBeenCalledWith(null)
    expect(l2).toHaveBeenCalledWith(null)
  })

  it('unsubscribe stops only that listener', async () => {
    const auth = makeAuth()
    const l1 = vi.fn(); const l2 = vi.fn()
    auth.onSessionChange(l1)
    const unsub2 = auth.onSessionChange(l2)
    unsub2()
    await auth.signOut()
    expect(l1).toHaveBeenCalledWith(null)
    expect(l2).not.toHaveBeenCalled()
  })

  it('a throwing listener does not break dispatch to peers or the caller', async () => {
    const auth = makeAuth()
    const bad = vi.fn(() => { throw new Error('boom') })
    const good = vi.fn()
    auth.onSessionChange(bad)
    auth.onSessionChange(good)
    await expect(auth.signOut()).resolves.toBeUndefined()
    expect(good).toHaveBeenCalledWith(null)
  })
})
