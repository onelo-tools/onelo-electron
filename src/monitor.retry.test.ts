/**
 * Delivery reliability for OneloMonitor (@onelo/electron).
 *
 * Regression cover for the bug where flush() spliced the buffer BEFORE the send,
 * never checked the response status, and swallowed everything in a bare catch —
 * so a live 503 from /api/sdk/monitor/events/batch silently destroyed a batch.
 *
 * Policy under test: ONE attempt per flush. 2xx → settled. 429 / 5xx / network
 * → the batch goes back in the buffer and the next 15s tick carries it (the
 * flush timer IS the retry, so an outage never multiplies request volume).
 * 4xx other than 429 → dropped loudly, since retrying is futile.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloMonitor } from './monitor'

const API = 'http://localhost:3000'
const KEY = 'pub_test_key'
const MAX_BUFFER_SIZE = 200

const res = (status: number, headers: Record<string, string> = {}): Response =>
  ({ status, headers: { get: (k: string) => headers[k] ?? null } }) as unknown as Response

const bufLen = (m: OneloMonitor): number =>
  (m as unknown as { buffer: unknown[] }).buffer.length

let fetchMock: ReturnType<typeof vi.fn>
let monitor: OneloMonitor

beforeEach(async () => {
  // Warm the module cache BEFORE fake timers: the send path does
  // `await import('./sdk-headers')`, and a cold module load needs the real event
  // loop — under fake timers it would never resolve and no fetch would happen.
  await import('./sdk-headers')
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  monitor = new OneloMonitor(KEY, API)
  // Constructor auto-emits an unconditional `session_opened` event — reset the
  // buffer so per-test event counts stay exact.
  ;(monitor as unknown as { buffer: unknown[] }).buffer.length = 0
})

afterEach(async () => {
  fetchMock.mockResolvedValue(res(204))
  await monitor.destroy()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Run a flush to completion. There is no backoff to advance through any more —
 * a drain is one request — so this deliberately does NOT move the clock: doing
 * so would let the monitor's own periodic 15s flush fire and make request counts
 * non-deterministic (which is exactly what the volume test asserts on).
 */
async function flushAll(m: OneloMonitor, timeoutMs?: number): Promise<void> {
  await m.flush(timeoutMs)
}

describe('OneloMonitor delivery — retry classification', () => {
  it('does not swallow a 503 — one attempt, then the NEXT flush delivers it', async () => {
    fetchMock.mockResolvedValueOnce(res(503))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1) // exactly one — no in-flight loop
    expect(bufLen(monitor)).toBe(1)            // and the event survived

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bufLen(monitor)).toBe(0)
  })

  // The load property that motivated dropping the retry loop: an outage must
  // cost the backend the SAME number of requests as healthy operation.
  it('never multiplies request volume during an outage — 1 request per flush', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })

    for (let i = 0; i < 5; i++) await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(5) // 5 flushes → 5 requests, not 15
  })

  it('re-queues the batch on a 503 (nothing is lost)', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })
    monitor.event('ai-response', { ok: true })

    await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(2) // both events back in the buffer

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    expect(body.events.map((e: { featureName: string }) => e.featureName)).toEqual(['checkout', 'ai-response'])
    expect(bufLen(monitor)).toBe(0)
  })

  it('re-queues on a network throw, and the next flush delivers', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(1)

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    expect(bufLen(monitor)).toBe(0)
  })

  it('does NOT retry a 401', async () => {
    fetchMock.mockResolvedValue(res(401))
    monitor.event('checkout', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a 400 — retrying a rejected payload cannot help', async () => {
    fetchMock.mockResolvedValue(res(400))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(0) // dropped deliberately, not re-queued forever
  })

  it('does NOT retry a 429, and holds off subsequent flushes for Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(res(429, { 'Retry-After': '60' }))
    monitor.event('checkout', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValue(res(204))
    monitor.event('later', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1) // held off — no network hit

    vi.setSystemTime(Date.now() + 61_000)
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // REGRESSION: a 429 used to classify as `done`, so `_drain` skipped `_requeue`
  // and the batch — already spliced out of the buffer — was destroyed. The test
  // above passes either way, because it only counts calls. THIS one asserts on
  // the payload: the events the hold-off exists to protect must survive it.
  it('re-queues the 429ed batch — the events are NOT lost', async () => {
    fetchMock.mockResolvedValueOnce(res(429, { 'Retry-After': '60' }))
    monitor.event('checkout', { ok: false, error: 'boom' })
    await flushAll(monitor)

    // Still buffered: the server explicitly did not accept it.
    expect(bufLen(monitor)).toBe(1)

    // After the hold-off it is actually delivered, with its payload intact.
    fetchMock.mockResolvedValue(res(204))
    vi.setSystemTime(Date.now() + 61_000)
    await flushAll(monitor)

    const sent = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
    expect(sent.events).toHaveLength(1)
    expect(sent.events[0].featureName).toBe('checkout')
    expect(bufLen(monitor)).toBe(0)
  })


  it('quit path: flush(timeoutMs) bounds the single request and re-queues', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor, 50)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(1) // preserved for the next run, not dropped
  })

  // The deadline must bound the REQUEST, not just the (now absent) retry loop:
  // a fetch that never settles used to be awaited forever on the quit path.
  it('quit path: a hung fetch cannot outlive the deadline', async () => {
    fetchMock.mockImplementation(() => new Promise(() => { /* never settles */ }))
    monitor.event('checkout', { ok: true })

    const done = monitor.flush(50)
    await vi.advanceTimersByTimeAsync(60) // the abort/timer race fires
    await done

    expect(bufLen(monitor)).toBe(1) // re-queued, and the flush actually returned
  })
})

describe('OneloMonitor delivery — bounded memory under a sustained outage', () => {
  it('never grows past the buffer cap while the backend is down', async () => {
    fetchMock.mockResolvedValue(res(503))

    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 100; i++) monitor.event(`evt-${round}-${i}`, { ok: true })
      await flushAll(monitor)
      expect(bufLen(monitor)).toBeLessThanOrEqual(MAX_BUFFER_SIZE)
    }
    expect(bufLen(monitor)).toBe(MAX_BUFFER_SIZE)
  })

  it('drops the OLDEST events first — newest telemetry wins, and drops are reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(res(503))

    for (let i = 0; i < MAX_BUFFER_SIZE; i++) monitor.event(`old-${i}`, { ok: true })
    await flushAll(monitor)
    for (let i = 0; i < 10; i++) monitor.event(`new-${i}`, { ok: true })

    expect(bufLen(monitor)).toBe(MAX_BUFFER_SIZE)
    const names = (monitor as unknown as { buffer: Array<{ featureName: string }> }).buffer
      .map((e) => e.featureName)
    expect(names).not.toContain('old-0')
    expect(names.at(-1)).toBe('new-9')
    expect(warn).toHaveBeenCalled()
  })
})

describe('OneloMonitor delivery — event time survives a delay', () => {
  it('stamps ts when the event happens, not when the batch is finally sent', async () => {
    // A batch that waits out an outage must still report WHEN it happened —
    // otherwise the dashboard attributes an outage's errors to the recovery.
    fetchMock.mockResolvedValueOnce(res(503))
    monitor.event('checkout', { ok: false, error: 'boom' })
    await flushAll(monitor)

    const happenedAt = Date.now()
    vi.setSystemTime(happenedAt + 10 * 60_000) // 10 minutes later

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)

    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const sentTs = Date.parse(body.events[0].ts)
    expect(sentTs).toBeLessThanOrEqual(happenedAt)
    expect(new Date(sentTs).toISOString()).toBe(body.events[0].ts) // ISO-8601 UTC
  })

  it('stamps ts on the feature_call_summary drain path too', async () => {
    fetchMock.mockResolvedValue(res(204))
    ;(monitor as unknown as { _trackFeatureCall: (n: string) => void })._trackFeatureCall('dark-mode')

    await flushAll(monitor)

    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const summary = body.events.find((e: { source: string }) => e.source === 'feature_call_summary')
    expect(summary).toBeDefined()
    expect(new Date(Date.parse(summary.ts)).toISOString()).toBe(summary.ts)
  })
})
