import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloMonitor } from './monitor'
import { OneloFeatures } from './features'

const MOCK_API = 'http://localhost:3000'
const MOCK_KEY = 'pub_test_key'

describe('OneloMonitor', () => {
  let monitor: OneloMonitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    monitor = new OneloMonitor(MOCK_KEY, MOCK_API)
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    monitor.destroy()
  })

  it('buffers events and does not send immediately', async () => {
    monitor.event('checkout', { ok: true, durationMs: 100 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends batch after flush()', async () => {
    // Both ok:true so nothing auto-flushes — the explicit flush() is the sole
    // sender (an ok:false event auto-flushes synchronously; see the track-error
    // test for that path).
    monitor.event('checkout', { ok: true })
    monitor.event('ai-response', { ok: true })
    await monitor.flush()

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${MOCK_API}/api/sdk/monitor/events/batch`)
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.publishableKey).toBe(MOCK_KEY)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].featureName).toBe('checkout')
    expect(body.events[0].ok).toBe(true)
  })

  it('clears buffer after flush()', async () => {
    monitor.event('checkout', { ok: true })
    await monitor.flush()
    await monitor.flush()

    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('does not send empty batch', async () => {
    await monitor.flush()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('OneloMonitor.track()', () => {
  let monitor: OneloMonitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    monitor = new OneloMonitor(MOCK_KEY, MOCK_API)
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response)
  })
  afterEach(() => { vi.restoreAllMocks(); monitor.destroy() })

  it('track() sends ok:true on success', async () => {
    const result = await monitor.track('checkout', async () => 42)
    expect(result).toBe(42)
    await monitor.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].ok).toBe(true)
    expect(body.events[0].source).toBe('track')
    expect(body.events[0].platform).toBe('electron')
  })

  it('track() sends ok:false and re-throws on error', async () => {
    await expect(
      monitor.track('checkout', async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')
    // ok:false auto-flushes (fire-and-forget) — wait for that fetch, don't add a
    // second flush() that races an empty buffer.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].ok).toBe(false)
    expect(body.events[0].error).toBe('boom')
  })

  it('_trackFeatureCall() aggregates into one feature_call_summary event (meta.calls=N)', async () => {
    monitor._trackFeatureCall('ai-chat')
    monitor._trackFeatureCall('ai-chat')
    monitor._trackFeatureCall('ai-chat')
    await monitor.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const summary = body.events.find((e: { featureName: string }) => e.featureName === 'ai-chat')
    expect(summary.source).toBe('feature_call_summary') // the source the backend roll-up recognises
    expect(summary.ok).toBe(true)
    expect(summary.meta.calls).toBe(3)                   // 3 calls collapsed into one event
  })

  it('feature-call counters stay OUT of the capped event buffer (never evict errors)', () => {
    // Parity with Swift: counts live in summaryBuffer, not the 200-cap buffer,
    // so a burst of feature discoveries cannot push out pending error events.
    for (let i = 0; i < 500; i++) monitor._trackFeatureCall(`feat-${i}`)
    expect((monitor as unknown as { buffer: unknown[] }).buffer.length).toBe(0)
    expect((monitor as unknown as { summaryBuffer: Map<string, number> }).summaryBuffer.size).toBe(500)
  })

  it('summary counters reset after flush (fresh window)', async () => {
    monitor._trackFeatureCall('ai-chat')
    await monitor.flush()
    expect((monitor as unknown as { summaryBuffer: Map<string, number> }).summaryBuffer.size).toBe(0)
  })

  it('setUserId() attaches userId to events', async () => {
    monitor.setUserId('user-abc')
    monitor.event('checkout', { ok: true })
    await monitor.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].userId).toBe('user-abc')
  })
})

describe('OneloMonitor session', () => {
  let monitor: OneloMonitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    monitor = new OneloMonitor(MOCK_KEY, MOCK_API)
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response)
  })
  afterEach(() => { vi.restoreAllMocks(); monitor.destroy() })

  it('attaches sessionId to events', async () => {
    monitor.event('checkout', { ok: true })
    await monitor.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].sessionId).toBeDefined()
    expect(typeof body.events[0].sessionId).toBe('string')
    expect(body.events[0].sessionId.length).toBeGreaterThan(0)
  })

  it('same sessionId on all events in one instance', async () => {
    monitor.event('a', { ok: true })
    monitor.event('b', { ok: true })
    await monitor.flush()
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.events[0].sessionId).toBe(body.events[1].sessionId)
  })
})

describe('OneloFeatures deduplication', () => {
  it('_trackFeatureCall fires only on first feature() call', () => {
    const trackSpy = vi.fn()
    const features = new OneloFeatures(MOCK_KEY, MOCK_API, { _trackFeatureCall: trackSpy } as any)
    features.feature('chat')
    features.feature('chat')
    features.feature('chat')
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('chat')
  })

  it('different features each fire once', () => {
    const trackSpy = vi.fn()
    const features = new OneloFeatures(MOCK_KEY, MOCK_API, { _trackFeatureCall: trackSpy } as any)
    features.feature('chat')
    features.feature('export')
    features.feature('chat')
    features.feature('export')
    expect(trackSpy).toHaveBeenCalledTimes(2)
  })
})
