import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloMonitor } from './monitor'

const KEY = 'onelo_pk_test'
const API = 'https://api.example.com'

describe('OneloMonitor context (environment + app version)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any
  beforeEach(() => { fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response) })
  afterEach(() => vi.restoreAllMocks())

  it('attaches meta.environment from the config default', async () => {
    const m = new OneloMonitor(KEY, API, { environment: 'staging' })
    m.event('checkout', { ok: true })
    await m.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].meta.environment).toBe('staging')
    await m.destroy()
  })

  it('a per-event meta.environment overrides the config default', async () => {
    const m = new OneloMonitor(KEY, API, { environment: 'staging' })
    m.event('checkout', { ok: true, meta: { environment: 'prod' } })
    await m.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].meta.environment).toBe('prod')
    await m.destroy()
  })

  it('attaches meta.app.version + build + bundleId', async () => {
    const m = new OneloMonitor(KEY, API, { bundleId: 'com.acme', appVersion: '1.4.2', appBuild: '77' })
    m.event('checkout', { ok: true })
    await m.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].meta.app).toEqual({ version: '1.4.2', build: '77', bundleId: 'com.acme' })
    await m.destroy()
  })

  it('omits meta.environment + meta.app when no context given', async () => {
    const m = new OneloMonitor(KEY, API)
    m.event('checkout', { ok: true })
    await m.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].meta.environment).toBeUndefined()
    expect(body.events[0].meta.app).toBeUndefined()
    await m.destroy()
  })
})

describe('OneloMonitor.flush(timeoutMs) bounded shutdown', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves within the timeout even when the network hangs', async () => {
    // fetch never settles → flush() would hang forever; flush(50) must return.
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))
    const m = new OneloMonitor(KEY, API)
    m.event('x', { ok: true })
    const start = Date.now()
    await m.flush(50)
    expect(Date.now() - start).toBeLessThan(500) // did not hang
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })
})
