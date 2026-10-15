/**
 * #735: feature snapshots are bound to the identity (and load generation) that
 * requested them — parity with Swift onelo-swift-staging#1 and JS #734.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

interface Pending { path: string; body: string; auth?: string; reply: (status: number, json: unknown) => void }
const pending: Pending[] = []
let auto: ((p: Pending) => { status: number; json: unknown } | null) | null = null

vi.mock('https', () => {
  const request = (opts: { path: string; headers?: Record<string, string> }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    const p: Pending = {
      path: opts.path, body: '', auth: opts.headers?.['Authorization'],
      reply: (status, json) => {
        const res = Object.assign(new EventEmitter(), { statusCode: status }) as EventEmitter & { statusCode: number }
        queueMicrotask(() => { cb(res); res.emit('data', Buffer.from(JSON.stringify(json))); res.emit('end') })
      },
    }
    return {
      on: () => {}, write: (c: string) => { p.body += c },
      end: () => {
        const a = auto?.(p)
        if (a) p.reply(a.status, a.json)
        else pending.push(p)
      },
    }
  }
  return { default: { request }, request }
})
vi.mock('http', () => {
  const request = () => ({ on: () => {}, write: () => {}, end: () => {} })
  return { default: { request }, request }
})
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))
const disk = new Map<string, { configVersion: number; features: Record<string, unknown> }>()
vi.mock('./feature-cache', () => ({
  readFeatureCache: (_k: string, u: string | null) => disk.get(String(u)) ?? null,
  writeFeatureCache: (_k: string, u: string | null, v: { configVersion: number; features: Record<string, unknown> }) => { disk.set(String(u), v) },
}))

import { OneloFeatures } from './features'

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const snap = (status: string, v = 7) => ({ config_version: v, features: { pro: { status } } })
const resolves = () => pending.filter((p) => p.path.includes('/resolve'))

function fakeStream() {
  const handlers: Record<string, (d: Record<string, unknown>) => void> = {}
  const providers: Array<() => Record<string, string>> = []
  let identity: ((i: { userId: string | null; anonymousFallback: boolean } | null) => void) | undefined
  return {
    on: (e: string, h: (d: Record<string, unknown>) => void) => { handlers[e] = h },
    emit: (e: string, d: Record<string, unknown>) => handlers[e]?.(d),
    addParamProvider: (fn: () => Record<string, string>) => providers.push(fn),
    onFallback: () => {},
    onConnectionIdentity: (fn: typeof identity) => { identity = fn },
    connect: (userId: string | null, anonymousFallback = false) => identity?.({ userId, anonymousFallback }),
    params: () => Object.assign({}, ...providers.map((p) => p())) as Record<string, string>,
    start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), reconnect: vi.fn(),
  }
}

function make(stream = true, token: string | null = null) {
  const userToken = { current: vi.fn(async () => token), refresh: vi.fn(async () => null) }
  const f = new OneloFeatures('onelo_pk_live_x', 'https://api', null, undefined, { userToken })
  const s = fakeStream()
  if (stream) f.attachEventStream(s as never)
  return { f, s }
}

describe('Electron OneloFeatures — identity-bound snapshots (#735)', () => {
  beforeEach(() => { pending.length = 0; auto = null; disk.clear(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it('drops a late anonymous /resolve that completes after sign-in', async () => {
    const { f } = make(false)
    void f._load(null)
    await flush()
    const anon = resolves()[0]
    void f._load('u1')
    await flush()
    resolves()[1].reply(200, snap('enabled'))
    await flush()
    anon.reply(200, snap('hidden', 8))
    await flush()
    expect(f.feature('pro').status).toBe('enabled')
    expect(disk.get('u1')?.features).toEqual({ pro: expect.objectContaining({ status: 'enabled' }) })
    f.stopPolling()
  })

  it('drops a late previous-user /resolve and never caches it under the new user', async () => {
    const { f } = make(false)
    void f._load('a')
    await flush()
    const forA = resolves()[0]
    void f._load('b')
    await flush()
    forA.reply(200, snap('enabled'))
    await flush()
    expect(f.feature('pro').status).toBe('hidden')
    expect(disk.has('b')).toBe(false)
    f.stopPolling()
  })

  it('does not apply an anonymous fallback answer for a signed-in user (refused token)', async () => {
    const { f } = make(false, 'tok')
    disk.set('u1', { configVersion: 3, features: { pro: { status: 'enabled', upgradeCta: false } } })
    auto = (p) => p.auth ? { status: 401, json: { detail: { error: 'invalid_user_token' } } } : { status: 200, json: { ...snap('hidden', 9), anonymous: true } }
    await f._load('u1')
    await flush()
    expect(f.feature('pro').status).toBe('enabled')
    expect(disk.get('u1')?.configVersion).toBe(3)
    f.stopPolling()
  })

  it('ignores a snapshot from an anonymous-fallback stream connection for a signed-in user', async () => {
    const { f, s } = make()
    await f._load('u1')
    s.connect('u1', true)
    s.emit('connected', snap('hidden'))
    expect(f.feature('pro').status).toBe('hidden')
    expect(disk.has('u1')).toBe(false)
    s.connect('u1', false)
    s.emit('connected', snap('enabled'))
    expect(f.feature('pro').status).toBe('enabled')
  })

  it('resets ready() on identity change and releases it only for the new identity', async () => {
    const { f, s } = make()
    await f._load(null)
    s.connect(null)
    s.emit('connected', snap('hidden'))
    await f.ready(50)
    await f._load('u1')
    let released = false
    void f.ready(10_000).then(() => { released = true })
    await flush()
    expect(released).toBe(false)
    s.connect('u1')
    s.emit('connected', snap('enabled'))
    await flush()
    expect(released).toBe(true)
  })

  it('does not keep the previous identity snapshot when the new one has no cache', async () => {
    const { f, s } = make()
    await f._load('a')
    s.connect('a')
    s.emit('connected', snap('enabled'))
    await f._load('b')
    expect(f.feature('pro').status).toBe('hidden')
    expect(s.params().since_version).toBe('0')
  })

  it('sends since_version=0 until the current identity confirms its version', async () => {
    disk.set('u1', { configVersion: 42, features: { pro: { status: 'enabled', upgradeCta: false } } })
    const { f, s } = make()
    await f._load('u1')
    expect(f.feature('pro').status).toBe('enabled') // persisted snapshot still renders
    expect(s.params().since_version).toBe('0')
    s.connect('u1')
    s.emit('connected', snap('enabled', 43))
    expect(s.params().since_version).toBe('43')
  })

  it('refresh() before the first identity load does not resolve anonymously', async () => {
    const { f } = make(false)
    await f.refresh(true)
    expect(resolves()).toHaveLength(0)
  })
})
