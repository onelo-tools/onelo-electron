/**
 * #659 — after a store purchase / plan switch the app kept the old plan until
 * the stream caught up. Every hosted container now reports a purchase or a
 * switch to one refresher, which re-resolves features + entitlement at once
 * and, for a pending switch, re-checks on a bounded backoff.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  listeners = new Map<string, Listener[]>()
  on(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb])
  }
  removeListener(event: string, cb: Listener) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== cb))
  }
  setWindowOpenHandler() {}
  executeJavaScript() { return Promise.resolve() }
  getURL() { return '' }
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  webContents = new FakeWebContents()
  listeners = new Map<string, Listener[]>()
  destroyed = false
  constructor(public opts: Record<string, unknown>) { FakeBrowserWindow.instances.push(this) }
  loadURL() { return Promise.resolve() }
  setMenuBarVisibility() {}
  on(event: string, cb: Listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]) }
  removeAllListeners(event: string) { this.listeners.set(event, []) }
  close() {
    if (this.destroyed) return
    this.destroyed = true
    for (const cb of this.listeners.get('closed') ?? []) cb()
  }
  isDestroyed() { return this.destroyed }
}

vi.mock('electron', () => ({ BrowserWindow: FakeBrowserWindow, shell: { openExternal: vi.fn(async () => true) } }))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => {
    const store = new Map<string, string>()
    return {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
      delete: vi.fn(async (k: string) => { store.delete(k) }),
      clear: vi.fn(async () => { store.clear() }),
    }
  }),
}))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: { supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't', allow_custom_branding: false, oauth_providers: [], paywall_enabled: true } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async (url: string) => {
      if (url.includes('/hosted-callback')) {
        return { status: 200, json: { access_token: 'tok', refresh_token: 'r', token_type: 'bearer', expires_in: 900, user: { id: 'u1', email: 'a@b.c' } } }
      }
      return { status: 200, json: {} }
    }),
  }
})

import { PlanChangeRefresher, PENDING_RECHECK_DELAYS_MS, type PlanChange } from './plan-change'
import { OneloElectronCustomerPortal } from './customer-portal'
import { OneloElectronAuth } from './auth'
import { BrandSource } from '@onelo/core'

beforeEach(() => {
  vi.useRealTimers()
  FakeBrowserWindow.instances = []
})

function navigate(win: FakeBrowserWindow, url: string) {
  const event = { preventDefault: vi.fn() }
  for (const cb of win.webContents.listeners.get('will-navigate') ?? []) cb(event, url)
  return event
}

async function waitForWindow(): Promise<FakeBrowserWindow> {
  for (let i = 0; i < 500 && FakeBrowserWindow.instances.length === 0; i++) await new Promise((r) => setTimeout(r, 1))
  return FakeBrowserWindow.instances[0]
}

describe('portal window reports the plan change (#659)', () => {
  function makePortal() {
    const auth = { revalidateEntitlement: vi.fn(async () => 'active'), getSession: vi.fn(), signOut: vi.fn(), isUserRevoked: false, brand: new BrandSource() }
    const portal = new OneloElectronCustomerPortal('https://api', 'onelo_pk_test', auth as never, 'myapp')
    const changes: PlanChange[] = []
    portal.setPlanChangeHandler((c) => changes.push(c))
    return { portal, changes }
  }

  it('a plan switch from the store in the portal window', async () => {
    const { portal, changes } = makePortal()
    const done = portal.presentUrl('https://st.onelo.tools/customer/portal?token=prt_1')
    navigate(await waitForWindow(), 'myapp://callback?source=store&event=plan_switch_pending')
    await done
    expect(changes).toEqual([{ kind: 'switched', reason: 'plan_switch_pending' }])
  })

  it('a purchase from the store in the portal window', async () => {
    const { portal, changes } = makePortal()
    const done = portal.presentUrl('https://st.onelo.tools/customer/portal?token=prt_1')
    navigate(await waitForWindow(), 'myapp://callback?code=c1')
    await done
    expect(changes).toEqual([{ kind: 'purchase' }])
  })

  it('the portal closing on its own Done is not a plan change', async () => {
    const { portal, changes } = makePortal()
    const done = portal.presentUrl('https://st.onelo.tools/customer/portal?token=prt_1')
    navigate(await waitForWindow(), 'myapp://callback?source=portal')
    await done
    expect(changes).toEqual([])
  })
})

describe('deep links report the plan change (#659)', () => {
  async function makeAuth() {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'myapp' })
    await auth.whenReady()
    const changes: PlanChange[] = []
    auth.setPlanChangeHandler((c) => changes.push(c))
    return { auth, changes }
  }

  it('a store switch finished in the system browser', async () => {
    const { auth, changes } = await makeAuth()
    expect(await auth.handleDeepLink('myapp://callback?source=store&event=plan_switched')).toBeNull()
    expect(changes).toEqual([{ kind: 'switched', reason: 'plan_switched' }])
  })

  it('a code exchanged after the store', async () => {
    const { auth, changes } = await makeAuth()
    expect(await auth.handleDeepLink('myapp://callback?code=c1')).not.toBeNull()
    expect(changes).toEqual([{ kind: 'purchase' }])
  })

  it('a foreign deep link is not a plan change', async () => {
    const { auth, changes } = await makeAuth()
    await auth.handleDeepLink('myapp://elsewhere?source=store&event=plan_switched')
    expect(changes).toEqual([])
  })
})

describe('PlanChangeRefresher (#659)', () => {
  function targets(applyAfterRefreshes: number) {
    let refreshes = 0
    let plan = 'pro'
    return {
      refreshFeatures: vi.fn(async () => { refreshes++; if (refreshes >= applyAfterRefreshes) plan = 'business' }),
      revalidateEntitlement: vi.fn(async () => {}),
      snapshot: () => plan,
    }
  }

  it('a pending switch is re-checked until the plan moves, then stops', async () => {
    vi.useFakeTimers()
    const t = targets(2)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(2)
    expect(t.revalidateEntitlement).toHaveBeenCalledTimes(2)
  })

  it('gives up after the bounded delays', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1 + PENDING_RECHECK_DELAYS_MS.length)
  })

  it('a purchase refreshes once at once', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    await new PlanChangeRefresher(t).handBack({ kind: 'purchase' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1)
    expect(t.revalidateEntitlement).toHaveBeenCalledTimes(1)
  })
})
