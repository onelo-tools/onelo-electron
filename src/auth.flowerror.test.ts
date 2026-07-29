import { describe, it, expect, vi, beforeEach } from 'vitest'

// #31 — presentAuthWindow must NOT throw without a window when resolveFlow fails
// (attestation / codesign / bundle-id mismatch → 403). It must open a graceful
// error window (presentFlowError) instead, so a naive host
// (`await presentAuthWindow(); mainWindow.show()`) never hits an unhandled
// rejection that leaves the app window hidden. Parity with Flutter #30 / RN retry.

vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => {
    const m = new Map<string, string>()
    return {
      get: vi.fn(async (k: string) => m.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { m.set(k, v) }),
      clear: vi.fn(async () => { m.clear() }),
    }
  }),
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

import { OneloElectronAuth } from './auth'
import { OneloError } from './types'

// Build an auth whose window presentation is fully stubbed (no real electron
// import), with resolveFlow spy-able so a test can force success vs a hard reject.
function makeAuth() {
  const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
  // presentAuthWindow awaits waitReady() first — resolve it immediately.
  vi.spyOn(auth as any, 'waitReady').mockResolvedValue(undefined)
  const presentFlowError = vi.spyOn(auth as any, 'presentFlowError').mockResolvedValue(null)
  const presentHostedUrl = vi.spyOn(auth as any, 'presentHostedUrl').mockResolvedValue(null)
  const resolveFlow = vi.spyOn(auth as any, 'resolveFlow')
  return { auth, presentFlowError, presentHostedUrl, resolveFlow }
}

describe('#31 — presentAuthWindow graceful flow-failure handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('on a resolveFlow 403 reject: shows the retry window (presentFlowError) and does NOT throw', async () => {
    const { auth, presentFlowError, presentHostedUrl, resolveFlow } = makeAuth()
    resolveFlow.mockRejectedValue(OneloError.server('Failed to resolve auth flow: bundle_id_mismatch'))

    // Must resolve (not reject) — a naive host awaits this then shows its window.
    await expect(auth.presentAuthWindow(null)).resolves.toBeNull()
    expect(presentFlowError).toHaveBeenCalledTimes(1)
    expect(presentFlowError).toHaveBeenCalledWith(null)
    expect(presentHostedUrl).not.toHaveBeenCalled()
  })

  it('on a resolveFlow non-OneloError reject: still routes to presentFlowError (no throw)', async () => {
    const { auth, presentFlowError, resolveFlow } = makeAuth()
    resolveFlow.mockRejectedValue(new Error('offline'))
    await expect(auth.presentAuthWindow(null)).resolves.toBeNull()
    expect(presentFlowError).toHaveBeenCalledTimes(1)
  })

  it('on a successful `present`: opens the hosted URL, never the error window', async () => {
    const { auth, presentFlowError, presentHostedUrl, resolveFlow } = makeAuth()
    resolveFlow.mockResolvedValue({ action: 'present', surface: 'signin', url: 'https://onelo.tools/hosted/x' })
    const parent = { id: 'win' } as any
    await auth.presentAuthWindow(parent)
    expect(presentHostedUrl).toHaveBeenCalledWith('https://onelo.tools/hosted/x', parent)
    expect(presentFlowError).not.toHaveBeenCalled()
  })

  it('a revoked key still throws (permanent, non-retryable) — no retry window', async () => {
    const { auth, presentFlowError, resolveFlow } = makeAuth()
    ;(auth as any).isRevoked = true
    await expect(auth.presentAuthWindow(null)).rejects.toMatchObject({ code: 'invalid_publishable_key' })
    expect(resolveFlow).not.toHaveBeenCalled()
    expect(presentFlowError).not.toHaveBeenCalled()
  })
})
