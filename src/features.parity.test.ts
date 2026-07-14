import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloFeatures } from './features'

// features.ts uses native https/http for _load/_resolve. These tests drive the
// SSE stream directly (never call _load), so an inert mock is enough.
const inert = { on() {}, write() {}, end() {} }
vi.mock('https', () => ({ default: { request: () => inert }, request: () => inert }))
vi.mock('http', () => ({ default: { request: () => inert }, request: () => inert }))

function fakeStream() {
  const handlers: Record<string, (d: Record<string, unknown>) => void> = {}
  const providers: Array<() => Record<string, string>> = []
  let fallback: (() => void) | undefined
  return {
    on: (e: string, h: (d: Record<string, unknown>) => void) => { handlers[e] = h },
    emit: (e: string, d: Record<string, unknown>) => handlers[e]?.(d),
    addParamProvider: (fn: () => Record<string, string>) => providers.push(fn),
    onFallback: (cb: () => void) => { fallback = cb },
    triggerFallback: () => fallback?.(),
    params: () => Object.assign({}, ...providers.map((p) => p())) as Record<string, string>,
    start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), reconnect: vi.fn(),
  }
}

describe('OneloFeatures — SSE snapshot + forward-compat', () => {
  let f: OneloFeatures
  afterEach(() => { (f as any)?._stopPolling?.() })

  it('applies a features_updated snapshot and fails CLOSED on an unknown status', () => {
    f = new OneloFeatures('pk', 'https://api.example.com', null)
    const s = fakeStream(); f.attachEventStream(s as any)
    s.emit('features_updated', {
      config_version: 5,
      features: { a: { status: 'enabled' }, b: { status: 'quantum-teleport' } },
    })
    expect(f.feature('a').isEnabled).toBe(true)
    const b = f.feature('b')
    expect(b.status).toBe('hidden')   // unknown status → hidden (fail-closed)
    expect(b.isVisible).toBe(false)   // NOT rendered as a broken affordance
  })

  it('exposes reason / requiredPlan / upgradeCTA and normalizes an unknown reason', () => {
    f = new OneloFeatures('pk', 'https://api.example.com', null)
    const s = fakeStream(); f.attachEventStream(s as any)
    s.emit('connected', {
      config_version: 6,
      features: {
        pro: { status: 'upsell', reason: 'plan', required_plan: 'pro', required_plan_label: 'Pro', upgrade_cta: true },
        weird: { status: 'disabled', reason: 'brand-new-reason' },
      },
    })
    const pro = f.feature('pro')
    expect(pro.reason).toBe('plan')
    expect(pro.requiredPlan).toBe('pro')
    expect(pro.requiredPlanLabel).toBe('Pro')
    expect(pro.upgradeCta).toBe(true)                                            // explicit backend flag
    expect(pro.upgradeHint).toEqual({ requiredPlan: 'pro', currentStatus: 'upsell' }) // derived (reason=plan + gated status)
    expect(pro.badgeLabel).toBe('Available in Pro')
    expect(f.feature('weird').reason).toBe('unknown') // unknown reason → 'unknown', feature kept
    expect(f.feature('weird').upgradeCta).toBe(false) // absent flag defaults false
    expect(f.feature('a-missing').upgradeHint).toBeNull()
  })

  it('since_version param provider reflects the latest applied config_version', () => {
    f = new OneloFeatures('pk', 'https://api.example.com', null)
    const s = fakeStream(); f.attachEventStream(s as any)
    expect(s.params().since_version).toBe('0')
    s.emit('features_updated', { config_version: 12, features: {} })
    expect(s.params().since_version).toBe('12')
    s.emit('up_to_date', { config_version: 20 }) // advances version without a snapshot
    expect(s.params().since_version).toBe('20')
  })

  it('feeds the flag value to monitor.recordFlag on feature()', () => {
    const monitor = { _trackFeatureCall: vi.fn(), recordFlag: vi.fn() }
    f = new OneloFeatures('pk', 'https://api.example.com', monitor)
    const s = fakeStream(); f.attachEventStream(s as any)
    s.emit('features_updated', { config_version: 1, features: { a: { status: 'enabled' } } })
    f.feature('a')
    expect(monitor.recordFlag).toHaveBeenCalledWith('a', 'enabled')
  })

  it('invalidateCache reconnects the stream (so the server resends a full snapshot)', () => {
    f = new OneloFeatures('pk', 'https://api.example.com', null)
    const s = fakeStream(); f.attachEventStream(s as any)
    ;(f as any).streamActive = true
    f.invalidateCache()
    expect(s.reconnect).toHaveBeenCalled()
    expect(s.params().since_version).toBe('0') // reset
  })

  it('a 429 cap (onFallback) starts the poll fallback', () => {
    f = new OneloFeatures('pk', 'https://api.example.com', null)
    const s = fakeStream(); f.attachEventStream(s as any)
    const pollSpy = vi.spyOn(f as any, '_startPolling')
    s.triggerFallback()
    expect(pollSpy).toHaveBeenCalled()
  })
})

describe('OneloFeatures — featureDefaultStatus + subscribe', () => {
  it('feature() returns the configured default for a slug not in the snapshot', () => {
    const f = new OneloFeatures('pk', 'https://api.example.com', null, undefined, { featureDefaultStatus: 'enabled' })
    expect(f.feature('not-loaded-yet').status).toBe('enabled')
    expect(f.feature('not-loaded-yet').isEnabled).toBe(true)
    f._stopPolling()
  })

  it('defaults to hidden (fail-closed) when unset', () => {
    const f = new OneloFeatures('pk', 'https://api.example.com', null)
    expect(f.feature('unknown').status).toBe('hidden')
    expect(f.feature('unknown').isVisible).toBe(false)
    f._stopPolling()
  })

  it('subscribe() fires on a cache change (invalidateCache) and unsubscribe stops it', () => {
    const f = new OneloFeatures('pk', 'https://api.example.com', null)
    let calls = 0
    const unsub = f.subscribe(() => { calls++ })
    f.invalidateCache()
    expect(calls).toBe(1)
    unsub()
    f.invalidateCache()
    expect(calls).toBe(1) // no longer notified
    f._stopPolling()
  })
})
