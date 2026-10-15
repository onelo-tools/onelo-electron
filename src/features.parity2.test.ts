/**
 * Phase 4/5 parity: the signed-in user's access token (Bearer) on every Features
 * call and userIdHash never sent (#518), moduleToken error mapping,
 * ready(timeout), refresh(force) debounce, 1% live-env batch-ping sampling.
 * Uses a controllable native-https mock (status + body settable per test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

interface Captured { path: string; body: string; headers: Record<string, string> }
const captured: Captured[] = []
// Per-test response override, keyed by URL substring. Default: 200 empty snapshot.
let responder: (path: string) => { status: number; json: unknown } = () => ({
  status: 200, json: { features: {}, config_version: 1 },
})

vi.mock('https', () => {
  const request = (opts: { path: string; headers?: Record<string, string> }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    const rec: Captured = { path: opts.path, body: '', headers: opts.headers ?? {} }
    captured.push(rec)
    const { status, json } = responder(opts.path)
    const res = Object.assign(new EventEmitter(), { statusCode: status }) as EventEmitter & { statusCode: number }
    queueMicrotask(() => {
      cb(res)
      res.emit('data', Buffer.from(JSON.stringify(json)))
      res.emit('end')
    })
    return { on: () => {}, write: (c: string) => { rec.body += c }, end: () => {} }
  }
  return { default: { request }, request }
})
vi.mock('http', () => {
  const request = () => ({ on: () => {}, write: () => {}, end: () => {} })
  return { default: { request }, request }
})
// Deterministic instance id + no disk cache in tests.
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))
vi.mock('./feature-cache', () => ({ readFeatureCache: () => null, writeFeatureCache: () => {} }))

import { OneloFeatures, OneloFeaturesError, FeatureState } from './features'

function body(path: string): Record<string, unknown> | undefined {
  const c = captured.find((x) => x.path.includes(path) && x.body.length > 0)
  return c ? (JSON.parse(c.body) as Record<string, unknown>) : undefined
}

const REFUSED = { status: 401, json: { detail: { error: 'invalid_user_token' } } }
const OK = { status: 200, json: { features: {}, config_version: 1, token: 'mod_abc' } }

/** A token source whose refresh() hands out `refreshed`. */
function tokens(current: string | null, refreshed: string | null = 'fresh') {
  return { current: vi.fn(async () => current), refresh: vi.fn(async () => refreshed) }
}
const bearersTo = (path: string) =>
  captured.filter((c) => c.path.includes(path)).map((c) => c.headers['Authorization'])

/** Replies per path substring, consumed in order (the last one repeats). */
function replies(map: Record<string, Array<{ status: number; json: unknown }>>) {
  responder = (path) => {
    const key = Object.keys(map).find((k) => path.includes(k))
    const q = key ? map[key] : undefined
    return q ? (q.length > 1 ? q.shift()! : q[0]) : OK
  }
}

describe('OneloFeatures — signed-in user proven with the access token (#518)', () => {
  beforeEach(() => {
    captured.length = 0
    responder = () => OK
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('sends Authorization: Bearer on resolve, batch-ping, poll and module-token', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test', userToken: tokens('access-1') })
    f.declare(['foo'])
    await f._load('u1')
    f.stopPolling()
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll('u1')
    await f.moduleToken('slug')
    expect(bearersTo('/api/sdk/features/resolve')).toEqual(['Bearer access-1'])
    expect(bearersTo('/api/sdk/features/batch-ping')).toEqual(['Bearer access-1'])
    expect(bearersTo('/api/sdk/features/poll')).toEqual(['Bearer access-1'])
    expect(bearersTo('/api/sdk/features/module-token')).toEqual(['Bearer access-1'])
  })

  it('never sends userIdHash (body or /poll query), even when identify() passes one', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test', userToken: tokens('access-1') })
    f.declare(['foo'])
    await f._load('u1', 'HASH123')
    f.stopPolling()
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll('u1')
    await f.moduleToken('slug')
    expect(body('/api/sdk/features/resolve')?.['userIdHash']).toBeUndefined()
    expect(body('/api/sdk/features/batch-ping')?.['userIdHash']).toBeUndefined()
    expect(body('/api/sdk/features/module-token')?.['userIdHash']).toBeUndefined()
    expect(captured.find((c) => c.path.includes('/poll'))?.path).not.toContain('userIdHash')
  })

  it('signed out: no Authorization and no userId', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test', userToken: tokens(null) })
    f.declare(['foo'])
    await f._load(null)
    f.stopPolling()
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll(null)
    for (const c of captured) expect(c.headers['Authorization']).toBeUndefined()
    expect(body('/api/sdk/features/resolve')?.['userId']).toBeUndefined()
    expect(captured.find((c) => c.path.includes('/poll'))?.path).not.toContain('userId')
  })

  it('401 invalid_user_token → one refresh, one retry with the new token', async () => {
    replies({ '/features/resolve': [REFUSED, OK] })
    const source = tokens('stale')
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { userToken: source })
    await f._load('u1')
    f.stopPolling()
    expect(bearersTo('/api/sdk/features/resolve')).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(source.refresh).toHaveBeenCalledTimes(1)
  })

  it('refused again → a signed-in resolve/poll never falls back anonymous (#735) and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies({ '/features/resolve': [REFUSED, REFUSED, OK], '/features/poll': [REFUSED, REFUSED, OK] })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { userToken: tokens('stale') })
    await f._load('u1')
    f.stopPolling()
    await (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll('u1')
    // An anonymous answer could never be applied to u1, so it is not requested.
    expect(bearersTo('/api/sdk/features/resolve')).toEqual(['Bearer stale', 'Bearer fresh'])
    // Same refusal episode: the one refresh is spent, so the poll does not
    // refresh again (no refresh loop, R1-1) and does not go anonymous.
    expect(bearersTo('/api/sdk/features/poll')).toEqual(['Bearer stale'])
    const polls = captured.filter((c) => c.path.includes('/features/poll'))
    expect(polls[0].path).toContain('userId=u1')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
  })

  it('batch-ping: refused twice → retried once, then sent without token or userId', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies({ '/batch-ping': [REFUSED, REFUSED, OK] })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test', userToken: tokens('stale') })
    f.declare(['foo'])
    await f._load('u1')
    f.stopPolling()
    expect(bearersTo('/api/sdk/features/batch-ping')).toEqual(['Bearer stale', 'Bearer fresh', undefined])
    const pings = captured.filter((c) => c.path.includes('/batch-ping'))
    expect(JSON.parse(pings[2].body)['userId']).toBeUndefined()
  })

  it('module-token: refused twice → notAuthenticated, never minted anonymously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies({ '/module-token': [REFUSED] })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { userToken: tokens('stale') })
    await f._load('u1'); f.stopPolling()
    await expect(f.moduleToken('slug')).rejects.toMatchObject({ code: 'notAuthenticated' })
    expect(bearersTo('/api/sdk/features/module-token')).toEqual(['Bearer stale', 'Bearer fresh'])
  })
})

describe('OneloFeatures.moduleToken()', () => {
  beforeEach(() => { captured.length = 0 })

  it('throws notAuthenticated with no identified user (no network)', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api')
    await expect(f.moduleToken('slug')).rejects.toBeInstanceOf(OneloFeaturesError)
    await expect(f.moduleToken('slug')).rejects.toMatchObject({ code: 'notAuthenticated' })
    expect(captured.filter((c) => c.path.includes('module-token'))).toHaveLength(0)
  })

  it('returns the token on 200', async () => {
    responder = () => ({ status: 200, json: { token: 'mod_abc' } })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('u1'); f.stopPolling()
    expect(await f.moduleToken('slug')).toBe('mod_abc')
  })

  it.each([
    [403, {}, 'notEntitled'],
    [401, { detail: { error: 'secure_mode_required' } }, 'secureModeRequired'],
    [401, { detail: { error: 'invalid_user_hash' } }, 'invalidUserHash'],
    [401, { detail: 'nope' }, 'notAuthenticated'],
    [503, { detail: 'secure_mode_unavailable' }, 'networkError'],
    [200, { token: '' }, 'networkError'],
  ])('maps HTTP %i → %s', async (status, json, code) => {
    responder = () => ({ status, json })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('u1'); f.stopPolling()
    await expect(f.moduleToken('slug')).rejects.toMatchObject({ code })
  })
})

describe('FeatureState.toJSON() — IPC-safe snapshot', () => {
  // Regression: Electron IPC (webContents.send / ipcMain.handle) serializes with
  // the structured-clone algorithm, which copies ONLY own enumerable data props and
  // DROPS prototype accessors. A raw FeatureState sent over IPC would arrive with
  // isVisible/isEnabled/badgeLabel/upgradeHint === undefined, so a `!isVisible`
  // render guard would hide every feature. toJSON() materializes them as own data.
  it('materializes every computed getter as an own data property', () => {
    const f = new FeatureState('advanced-export', 'upsell', 'plan', 'pro', 'Pro', true)
    const snap = f.toJSON()
    // Own props (not just inherited getters) so structured-clone preserves them.
    for (const key of ['isEnabled', 'isVisible', 'isDisabled', 'isGreyed', 'isUpsell', 'isNew', 'isBeta', 'isComingSoon', 'badgeLabel', 'upgradeHint']) {
      expect(Object.prototype.hasOwnProperty.call(snap, key)).toBe(true)
    }
    expect(snap.status).toBe('upsell')
    expect(snap.isUpsell).toBe(true)
    expect(snap.isVisible).toBe(true)
    expect(snap.isEnabled).toBe(false)
    expect(snap.badgeLabel).toBe(f.badgeLabel)
    expect(snap.upgradeHint).toEqual(f.upgradeHint)
  })

  it('survives structuredClone with getters intact (the real IPC path)', () => {
    const f = new FeatureState('advanced-export', 'greyed', 'plan', 'pro', 'Pro', true)
    // structuredClone is the exact algorithm Electron IPC uses. On the instance it
    // would strip the getters; on the snapshot every value must survive.
    const cloned = structuredClone(f.toJSON())
    expect(cloned.isVisible).toBe(true)
    expect(cloned.isGreyed).toBe(true)
    expect(cloned.badgeLabel).toBe('🔒')
    expect(cloned.requiredPlanLabel).toBe('Pro')
    // Proof of the defect: the raw instance loses its getters over the same clone.
    const rawCloned = structuredClone({ ...f }) as Record<string, unknown>
    expect(rawCloned.isVisible).toBeUndefined()
  })

  it('featureSnapshot(name) returns the same plain object', () => {
    const feat = new OneloFeatures('onelo_pk_test_x', 'https://api')
    const snap = feat.featureSnapshot('never-seen')
    expect(Object.prototype.hasOwnProperty.call(snap, 'isVisible')).toBe(true)
    // Unknown slug → default status (hidden) → not visible.
    expect(snap.isVisible).toBe(false)
    expect(snap.name).toBe('never-seen')
  })
})

describe('OneloFeatures.ready() / refresh()', () => {
  beforeEach(() => { captured.length = 0; responder = () => ({ status: 200, json: { features: {}, config_version: 1 } }) })

  it('ready() resolves on the timeout when no event ever lands', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api')
    const start = Date.now()
    await f.ready(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })

  it('ready() resolves immediately once a resolve has landed', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('u1'); f.stopPolling() // _resolve signals firstEvent
    const start = Date.now()
    await f.ready(5000)
    expect(Date.now() - start).toBeLessThan(50) // did NOT wait the 5s
  })

  it('refresh() is debounced unless forced', async () => {
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('u1'); f.stopPolling()
    captured.length = 0
    const resolves = (): number => captured.filter((c) => c.path.includes('/resolve')).length
    await f.refresh()               // first (lastRefreshAt=0) → fires
    const after1 = resolves()
    expect(after1).toBeGreaterThanOrEqual(1)
    await f.refresh()               // immediately again → debounced (within 1s)
    expect(resolves()).toBe(after1) // no new /resolve
    await f.refresh(true)           // force bypasses the debounce → fires
    expect(resolves()).toBeGreaterThan(after1)
  })
})

describe('OneloFeatures identity-change cache isolation (Finding 4)', () => {
  beforeEach(() => { captured.length = 0 })

  it('clears the prior identity flags on identity change (does not rely on the resolve snapshot)', async () => {
    // User A resolves with `premium` enabled.
    responder = () => ({ status: 200, json: { features: { premium: { status: 'enabled' } }, config_version: 5 } })
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    await f._load('A'); f.stopPolling()
    expect(f.feature('premium').status).toBe('enabled')

    // Logout → _load(null). The next resolve returns NO snapshot (features
    // absent) — so if the cache weren't cleared on identity change, A's premium
    // flag would still be visible to the anonymous session.
    responder = () => ({ status: 200, json: { config_version: 6 } })
    await f._load(null); f.stopPolling()
    expect(f.feature('premium').status).toBe('hidden') // cleared, fail-closed
  })
})

describe('OneloFeatures 1% live-env batch-ping sampling', () => {
  beforeEach(() => { captured.length = 0; responder = () => ({ status: 200, json: { features: {}, config_version: 1 } }) })
  afterEach(() => { vi.restoreAllMocks() })

  it('live env: skips the batch-ping when the 1% coin loses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // > 0.01 → skip
    const f = new OneloFeatures('onelo_pk_live_x', 'https://api')
    f.declare(['foo'])
    await f._load('u1'); f.stopPolling()
    expect(captured.filter((c) => c.path.includes('batch-ping'))).toHaveLength(0)
  })

  it('live env: pings when the 1% coin wins', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0) // <= 0.01 → ping
    const f = new OneloFeatures('onelo_pk_live_x', 'https://api')
    f.declare(['foo'])
    await f._load('u1'); f.stopPolling()
    expect(captured.filter((c) => c.path.includes('batch-ping')).length).toBeGreaterThanOrEqual(1)
  })

  it('test env: always pings regardless of the coin', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const f = new OneloFeatures('onelo_pk_test_x', 'https://api', null, undefined, { featureEnvironment: 'test' })
    f.declare(['foo'])
    await f._load('u1'); f.stopPolling()
    expect(captured.filter((c) => c.path.includes('batch-ping')).length).toBeGreaterThanOrEqual(1)
  })
})
