import { describe, it, expect, vi, beforeEach } from 'vitest'

// H3 parity: refreshSession must read the backend's HTTPException body shape
// ({ detail: { error | error_code } }) — NOT a top-level `error` — and map:
//   banned / session_compromised  → userRevoked (+ isUserRevoked, notify null)
//   no_plan_available             → planRequired (NOT a revocation)
//   session_expired / _invalid    → clear + null
// and ALWAYS notify(null) + clear storage on any non-200. Verified against
// backend/app/routes/sdk_auth.py refresh handler + JS _doRefresh.

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
    // Config bootstrap (constructor) resolves quietly.
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: { tenant_id: 't1', allow_custom_branding: false } }),
    httpPost: (...a: unknown[]) => httpPost(...(a as [])),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth(): OneloElectronAuth {
  return new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
}

describe('refreshSession error mapping (H3)', () => {
  beforeEach(() => {
    httpPost.mockReset()
    storage.get.mockReset().mockResolvedValue('rtok') // a stored refresh token so refresh proceeds
    storage.clear.mockReset().mockResolvedValue(undefined)
  })

  it('banned → throws (userRevoked), clears storage, notifies null, sets isUserRevoked', async () => {
    const auth = makeAuth()
    const notify = vi.fn(); auth.onSessionChange(notify)
    httpPost.mockResolvedValue({ status: 401, json: { detail: { error: 'banned' } } })
    await expect(auth.refreshSession()).rejects.toThrow()
    expect(storage.clear).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(null)
    expect(auth.isUserRevoked).toBe(true)
  })

  it('session_compromised → throws (userRevoked) + isUserRevoked', async () => {
    const auth = makeAuth()
    httpPost.mockResolvedValue({ status: 401, json: { detail: { error: 'session_compromised' } } })
    await expect(auth.refreshSession()).rejects.toThrow()
    expect(auth.isUserRevoked).toBe(true)
  })

  it('no_plan_available (error_code) → throws noActivePlan, NOT a revocation', async () => {
    const auth = makeAuth()
    httpPost.mockResolvedValue({ status: 403, json: { detail: { error_code: 'no_plan_available' } } })
    // Lapsed subscription = `no_active_plan` (route to store/upgrade), not
    // `plan_required` (custom-UI/loadAuthView) and not a revocation.
    const err = await auth.refreshSession().catch((e) => e)
    expect(err?.code).toBe('no_active_plan')
    expect(storage.clear).toHaveBeenCalled()
    expect(auth.isUserRevoked).toBe(false)
  })

  it('session_expired → resolves null, notifies null, NOT revoked', async () => {
    const auth = makeAuth()
    const notify = vi.fn(); auth.onSessionChange(notify)
    httpPost.mockResolvedValue({ status: 401, json: { detail: { error: 'session_expired' } } })
    await expect(auth.refreshSession()).resolves.toBeNull()
    expect(storage.clear).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(null)
    expect(auth.isUserRevoked).toBe(false)
  })

  it('dead legacy shape: top-level {error:"user_revoked"} is NOT treated as a revocation (proves old branch removed)', async () => {
    const auth = makeAuth()
    // The backend never emits this; the old code keyed on it. With H3 it falls
    // through to benign clear+null (no isUserRevoked), because only detail.error
    // is read now.
    httpPost.mockResolvedValue({ status: 401, json: { error: 'user_revoked' } })
    await expect(auth.refreshSession()).resolves.toBeNull()
    expect(auth.isUserRevoked).toBe(false)
  })
})
