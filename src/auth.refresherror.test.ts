import { describe, it, expect, vi, beforeEach } from 'vitest'

// H3 parity: refreshSession must read the backend's HTTPException body shape
// ({ detail: { error | error_code } }) — NOT a top-level `error` — and map:
//   banned                                   → userRevoked (+ isUserRevoked, notify null)
//   no_plan_available                        → noActivePlan (NOT a revocation)
//   session_compromised / _expired / _invalid → sessionEnded, neutral (#548)
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

  it.each(['session_compromised', 'session_expired', 'session_invalid'])(
    '%s → throws the neutral session_ended (never "suspended"), clears, notifies null, NOT revoked',
    async (code) => {
      const auth = makeAuth()
      const notify = vi.fn(); auth.onSessionChange(notify)
      httpPost.mockResolvedValue({ status: 401, json: { detail: { error: code } } })
      const err = await auth.refreshSession().catch((e) => e)
      expect(err?.code).toBe('session_ended')
      expect(err?.message).toBe('Your session ended — please sign in again')
      expect(storage.clear).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(null)
      expect(auth.isUserRevoked).toBe(false)
    },
  )

  it('getSession near expiry: a refused refresh resolves null (no throw out of background reads)', async () => {
    const auth = makeAuth()
    storage.get.mockReset().mockImplementation(async (k: string) =>
      k.includes('expires') ? String(Math.floor(Date.now() / 1000) + 10)
        : k.includes('user') ? JSON.stringify({ id: 'u1' }) : 'tok')
    httpPost.mockResolvedValue({ status: 401, json: { detail: { error: 'session_compromised' } } })
    await expect(auth.getSession()).resolves.toBeNull()
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



  it('dead legacy shape: top-level {error:"user_revoked"} is NOT treated as a revocation (proves old branch removed)', async () => {
    const auth = makeAuth()
    // The backend never emits this; the old code keyed on it. With H3 it falls
    // through to the neutral session_ended (no isUserRevoked), because only
    // detail.error is read now.
    httpPost.mockResolvedValue({ status: 401, json: { error: 'user_revoked' } })
    await expect(auth.refreshSession()).rejects.toMatchObject({ code: 'session_ended' })
    expect(auth.isUserRevoked).toBe(false)
  })
})

// #547/#548: a transient refusal never ends the session.
describe('refreshSession transient failures (#548)', () => {
  beforeEach(() => {
    httpPost.mockReset()
    storage.get.mockReset().mockResolvedValue('rtok')
    storage.clear.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    [503, { detail: { error: 'refresh_unavailable' } }],
    [500, {}],
    [429, {}],
  ])('%s → keeps the session (no clear, no notify), throws server_error, retries at +5 s', async (status, json) => {
    vi.useFakeTimers()
    try {
      const auth = makeAuth()
      const notify = vi.fn(); auth.onSessionChange(notify)
      httpPost.mockResolvedValue({ status, json })
      const err = await auth.refreshSession().catch((e) => e)
      expect(err?.code).toBe('server_error')
      expect(storage.clear).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalledWith(null)
      expect(httpPost).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(httpPost).toHaveBeenCalledTimes(2) // retried inside the 30 s grace window
      auth.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a lost response keeps the session and retries', async () => {
    vi.useFakeTimers()
    try {
      const auth = makeAuth()
      httpPost.mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValue({ status: 401, json: { detail: { error: 'session_compromised' } } })
      await expect(auth.refreshSession()).rejects.toThrow('socket hang up')
      expect(storage.clear).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(httpPost).toHaveBeenCalledTimes(2)
      auth.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

// #518: a Features call whose token was refused refreshes the session while the
// scheduled refresh may be running too. Both must share ONE /auth/refresh, or
// the rotating refresh token is sent twice and the backend revokes the session.
describe('refreshSession single-flight (#518)', () => {
  beforeEach(() => {
    httpPost.mockReset()
    storage.get.mockReset().mockResolvedValue('rtok')
    storage.clear.mockReset().mockResolvedValue(undefined)
  })

  it('concurrent callers share one /auth/refresh', async () => {
    const auth = makeAuth()
    let release!: (v: unknown) => void
    httpPost.mockImplementation(() => new Promise((r) => { release = r }))
    const a = auth.refreshSession()
    const b = auth.refreshSession()
    await vi.waitFor(() => { expect(httpPost).toHaveBeenCalledTimes(1) })
    release({ status: 401, json: { detail: { error: 'session_expired' } } })
    const both = await Promise.allSettled([a, b])
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(httpPost).toHaveBeenCalledTimes(1)
    // Settled → the next refresh is a new request.
    httpPost.mockResolvedValue({ status: 401, json: { detail: { error: 'session_expired' } } })
    await auth.refreshSession().catch(() => {})
    expect(httpPost).toHaveBeenCalledTimes(2)
  })
})
