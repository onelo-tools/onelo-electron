/**
 * #518 wiring (Electron): Onelo hands Features and the Event Stream the auth
 * session's access token, and a server that refuses every token does not loop
 * refresh → session change → features._load → refresh (review R1-1).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  hasKeysSync: vi.fn().mockReturnValue(false),
}
vi.mock('./storage', () => ({ SecureTokenStorage: vi.fn().mockImplementation(() => storage) }))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null), getCodesignOS: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockReturnValue('inst-1') }))
vi.mock('./feature-cache', () => ({ readFeatureCache: () => null, writeFeatureCache: () => {} }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: {} }),
    httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
  }
})

// Features REST goes through node https: every call with a Bearer is refused.
const featureAuths: Array<string | undefined> = []
const feedbackAuths: Array<string | undefined> = []
vi.mock('https', () => {
  const request = (opts: { path: string; headers?: Record<string, string> }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    const auth = opts.headers?.['Authorization']
    if (opts.path.includes('/api/sdk/features/')) featureAuths.push(auth)
    if (opts.path.includes('/api/sdk/feedback/initiate')) feedbackAuths.push(auth)
    const [status, json] = opts.path.includes('/api/sdk/feedback/initiate')
      ? [200, { hosted_url: 'https://onelo.tools/feedback/hosted?ft=x' }]
      : auth
      ? [401, { detail: { error: 'invalid_user_token' } }]
      : [200, { features: {}, config_version: 1 }]
    const res = Object.assign(new EventEmitter(), { statusCode: status }) as EventEmitter & { statusCode: number }
    queueMicrotask(() => { cb(res); res.emit('data', Buffer.from(JSON.stringify(json))); res.emit('end') })
    return { on: () => {}, write: () => {}, end: () => {} }
  }
  return { default: { request }, request }
})

import { Onelo } from './onelo'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('Onelo (Electron) — Features use the auth session token (#518)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sends the session token, refreshes through auth once, and does not loop', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const streamAuths: Array<string | undefined> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const auth = (init?.headers as Record<string, string>)['Authorization']
      streamAuths.push(auth)
      if (auth) return { status: 401, ok: false, body: null, json: async () => ({ detail: { error: 'invalid_user_token' } }) } as unknown as Response
      return { status: 200, ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } } as unknown as Response
    })
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.example.com', autoLifecycleRefresh: false })
    onelo.features.declare(['hero']) // test key → batch-ping on every load
    for (let i = 0; i < 5; i++) await tick()

    let n = 0
    const session = () => ({ accessToken: `tok-${n}`, refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
    vi.spyOn(onelo.auth, 'getSession').mockImplementation(async () => session() as never)
    const notify = (userId: string | null) =>
      (onelo.auth as unknown as { _notifySessionChange: (u: string | null) => void })._notifySessionChange(userId)
    // Like the real refresh: new token saved, session change published.
    const refresh = vi.spyOn(onelo.auth, 'refreshSession').mockImplementation(async () => {
      n++
      notify('u1')
      return session() as never
    })
    featureAuths.length = 0
    streamAuths.length = 0
    notify('u1') // sign-in → features._load('u1')
    for (let i = 0; i < 40; i++) await tick()

    expect(featureAuths[0]).toBe('Bearer tok-0')
    expect(streamAuths[0]).toBe('Bearer tok-0')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(featureAuths.length + streamAuths.length).toBeLessThan(20)
    await onelo.destroy()
  })
})

describe('Onelo (Electron) — feedback initiate uses the auth session token (#820)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('feedback initiate carries the signed-in session token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ({ status: 200, ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }) as unknown as Response)
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.example.com', autoLifecycleRefresh: false })
    vi.spyOn(onelo.auth, 'getSession').mockResolvedValue(
      { accessToken: 'at-1', refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } } as never)
    feedbackAuths.length = 0
    const r = await (onelo.feedback as unknown as { _initiate: () => Promise<{ ok: boolean }> })._initiate()
    expect(r.ok).toBe(true)
    expect(feedbackAuths).toEqual(['Bearer at-1'])
    await onelo.destroy()
  })
})

describe('Onelo (Electron) — features wait for session restore (#735)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('does not load features anonymously while the stored session is being restored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ({ status: 200, ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }) as unknown as Response)
    let finishRestore: (v: null) => void = () => {}
    const restore = new Promise<null>((r) => { finishRestore = r })
    storage.get.mockImplementation(() => restore)
    // restoreAllMocks in earlier tests drops the storage factory; re-bind it.
    const { SecureTokenStorage } = await import('./storage')
    vi.mocked(SecureTokenStorage).mockImplementation(() => storage as never)
    const { OneloFeatures } = await import('./features')
    const load = vi.spyOn(OneloFeatures.prototype, '_load')
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.example.com', autoLifecycleRefresh: false })
    // Only this instance's loads (an earlier test's client may still settle).
    const mine = () => load.mock.calls.filter((_, i) => load.mock.contexts[i] === onelo.features)
    await tick()
    expect(mine()).toEqual([])
    finishRestore(null) // no stored session → anonymous
    for (let i = 0; i < 5; i++) await tick()
    expect(mine()).toEqual([[null]])
    storage.get.mockResolvedValue(null)
    await onelo.destroy()
  })
  it('loads the stored user when the session is kept through a transient refresh failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ({ status: 200, ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }) as unknown as Response)
    const { SecureTokenStorage } = await import('./storage')
    vi.mocked(SecureTokenStorage).mockImplementation(() => storage as never)
    const { OneloFeatures } = await import('./features')
    const { OneloElectronAuth } = await import('./auth')
    // getSession() answers the stored session without a session-change event
    // (expired token + offline refresh, auth.ts getSession transient branch).
    vi.spyOn(OneloElectronAuth.prototype, 'getSession').mockResolvedValue(
      { accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } } as never)
    const load = vi.spyOn(OneloFeatures.prototype, '_load')
    const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.example.com', autoLifecycleRefresh: false })
    const mine = () => load.mock.calls.filter((_, i) => load.mock.contexts[i] === onelo.features)
    for (let i = 0; i < 5; i++) await tick()
    expect(mine()).toEqual([['u1']])
    await onelo.destroy()
  })
})
