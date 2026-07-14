import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloMonitor } from './monitor'

const API = 'http://localhost:3000'
const KEY = 'pub_test_key'

function lastBody(fetchSpy: { mock: { calls: unknown[][] } }): any {
  const calls = fetchSpy.mock.calls
  const opts = calls[calls.length - 1][1] as RequestInit
  return JSON.parse(opts.body as string)
}

describe('OneloMonitor — parity (flags / breadcrumbs / scrub / capture / device)', () => {
  let m: OneloMonitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any
  beforeEach(() => {
    m = new OneloMonitor(KEY, API, { bundleId: 'com.acme.app' })
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response)
  })
  afterEach(() => { vi.restoreAllMocks(); void m.destroy() })

  it('attaches the flag snapshot to ERROR events only (flag↔error correlation)', async () => {
    m.recordFlag('chat', 'enabled')
    m.recordFlag('export', 'hidden')
    m.event('checkout', { ok: false, error: 'boom' })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(lastBody(fetchSpy).events[0].meta.flags).toEqual({ chat: 'enabled', export: 'hidden' })

    fetchSpy.mockClear()
    m.event('ok-event', { ok: true })
    await m.flush()
    expect(lastBody(fetchSpy).events[0].meta.flags).toBeUndefined() // not on success
  })

  it('snapshots breadcrumbs into error meta, not success meta', async () => {
    m.breadcrumb('opened checkout', { category: 'nav' })
    m.breadcrumb('clicked pay')
    m.capture(new Error('payment failed'))
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const ev = lastBody(fetchSpy).events[0]
    expect(ev.meta.breadcrumbs).toHaveLength(2)
    expect(ev.meta.breadcrumbs[1].message).toBe('clicked pay')
    expect(ev.error).toBe('payment failed')
    expect(ev.meta.errorType).toBe('Error')
    expect(typeof ev.meta.stack).toBe('string')
  })

  it('scrubs PII from meta + the error string before sending', async () => {
    m.event('login', { ok: false, error: 'auth failed with Bearer abc123DEF456ghi789', meta: { password: 'hunter2', note: 'ok' } })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const ev = lastBody(fetchSpy).events[0]
    expect(ev.meta.password).toBe('[REDACTED]')
    expect(ev.meta.note).toBe('ok')
    expect(ev.meta._onelo_redacted).toContain('password')
    expect(ev.error).toContain('[REDACTED]')
    expect(ev.error).not.toContain('abc123DEF456ghi789')
  })

  it('attaches device context + static sdk meta', async () => {
    m.event('x', { ok: false, error: 'e' })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const ev = lastBody(fetchSpy).events[0]
    expect(ev.meta.sdk).toEqual({ name: '@onelo/electron', version: expect.any(String) })
    expect(ev.meta.device.platform).toBe(process.platform)
    expect(ev.meta.app).toEqual({ bundleId: 'com.acme.app' })
  })

  it('breadcrumb messages are scrubbed on the way in', async () => {
    m.breadcrumb('user token = Bearer zzz111YYY222xxx333')
    m.capture(new Error('e'))
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const crumb = lastBody(fetchSpy).events[0].meta.breadcrumbs[0].message
    expect(crumb).toContain('[REDACTED]')
    expect(crumb).not.toContain('zzz111YYY222xxx333')
  })
})

describe('OneloMonitor — dual-instance (latest-wins global routing)', () => {
  it('routes an uncaught crash to the MOST RECENT live monitor', async () => {
    const a = new OneloMonitor(KEY, API)
    const b = new OneloMonitor(KEY, API) // becomes active
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response)
    try {
      ;(process as NodeJS.EventEmitter).emit('uncaughtExceptionMonitor', new Error('crash'))
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      const ev = lastBody(fetchSpy as any).events[0]
      expect(ev.featureName).toBe('unhandled')
      expect(ev.sessionId).toBe((b as any).sessionId)      // routed to b (latest)
      expect(ev.sessionId).not.toBe((a as any).sessionId)  // NOT the stale first instance
    } finally { vi.restoreAllMocks(); void a.destroy(); void b.destroy() }
  })
})
