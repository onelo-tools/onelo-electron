/**
 * Regression for the magic-link "second window" bug (Turingo, 2026-08-20):
 * the hosted "Check your inbox" window was never parked, so when the deep
 * link came back through the OS (email → system browser → this app's
 * protocol handler), handleDeepLink had nothing to settle and just opened a
 * brand-new window next to the original — which stayed open, stuck forever.
 *
 * presentHostedUrl must now park the flow the moment its window opens, and
 * settlePendingFlow (called from handleDeepLink) must close that window
 * instead of leaving it orphaned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  listeners = new Map<string, Listener[]>()
  on(event: string, cb: Listener) {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
  }
  removeListener(event: string, cb: Listener) {
    const arr = this.listeners.get(event) ?? []
    this.listeners.set(event, arr.filter((l) => l !== cb))
  }
  setWindowOpenHandler() {}
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  webContents = new FakeWebContents()
  listeners = new Map<string, Listener[]>()
  destroyed = false
  closeCalls = 0
  constructor(public opts: Record<string, unknown>) {
    FakeBrowserWindow.instances.push(this)
  }
  loadURL() {}
  setMenuBarVisibility() {}
  on(event: string, cb: Listener) {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
  }
  removeAllListeners(event: string) {
    this.listeners.set(event, [])
  }
  close() {
    this.closeCalls++
    if (this.destroyed) return
    this.destroyed = true
    for (const cb of this.listeners.get('closed') ?? []) cb()
  }
  isDestroyed() {
    return this.destroyed
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal: vi.fn(async () => true) },
}))
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
        return {
          status: 200,
          json: {
            supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
            allow_custom_branding: false, oauth_providers: [], paywall_enabled: false,
          },
        }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
}

beforeEach(() => {
  FakeBrowserWindow.instances = []
})

describe('a magic link returning by deep link', () => {
  it('closes the original waiting window instead of leaving it orphaned when the gate refuses', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)

    const HOSTED_URL = 'https://st.onelo.tools/auth/hosted?token=x'
    await (auth as any).rememberHostedOrigin(HOSTED_URL)

    // Simulates presentAuthWindow opening the "Check your inbox" window and
    // the hosted page transitioning in place (no in-window navigation) after
    // the user requests a magic link — exactly what leaves nothing to react
    // to inside `win` when the email is opened elsewhere.
    const flowPromise = auth.presentHostedUrl(HOSTED_URL, null)
    await new Promise((r) => setTimeout(r, 0)) // let the dynamic import('electron') settle
    expect(FakeBrowserWindow.instances).toHaveLength(1)
    const waitingWindow = FakeBrowserWindow.instances[0]
    expect(waitingWindow.destroyed).toBe(false)

    // The email link resolves in the system browser and bounces the gate
    // refusal back into the app via the OS-level deep link — completely
    // disconnected from `waitingWindow`.
    // Not awaited: handleDeepLink's gate branch returns the SECOND window's
    // presentHostedUrl promise, which (like a real "No active plan" screen)
    // only resolves when a person closes it — awaiting it here would hang
    // the test on a window nobody is driving. Settling the original window
    // happens synchronously before that second window is even opened.
    const gateUrl = `${HOSTED_URL}&reason=no_plan`
    void (auth as any).handleDeepLink(`turingo://callback?gate=${encodeURIComponent(gateUrl)}`)
    await new Promise((r) => setTimeout(r, 0))

    // The original window must be closed — not left open as a stuck second
    // "Check your inbox" screen next to the new gate window.
    expect(waitingWindow.closeCalls).toBe(1)
    expect(waitingWindow.destroyed).toBe(true)

    // The original presentHostedUrl caller must be released, not hang forever.
    await expect(flowPromise).resolves.toBeNull()

    // Exactly one NEW window (the gate/"No active plan" screen) — not a
    // second window on top of the still-open first one.
    expect(FakeBrowserWindow.instances).toHaveLength(2)
    expect(FakeBrowserWindow.instances[1]).not.toBe(waitingWindow)
  })

  it('closes the original waiting window and resolves the real session on success', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)

    const HOSTED_URL = 'https://st.onelo.tools/auth/hosted?token=x'
    await (auth as any).rememberHostedOrigin(HOSTED_URL)

    const flowPromise = auth.presentHostedUrl(HOSTED_URL, null)
    await new Promise((r) => setTimeout(r, 0)) // let the dynamic import('electron') settle
    const waitingWindow = FakeBrowserWindow.instances[0]

    const { httpPost } = await import('@onelo/core')
    ;(httpPost as any).mockResolvedValueOnce({
      status: 200,
      json: {
        accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() / 1000 + 3600,
        user: { id: 'u1', role: 'member', tenantId: null, entitlement: 'active' },
      },
    })

    const session = await (auth as any).handleDeepLink('turingo://callback?code=abc123')

    expect(session).not.toBeNull()
    expect(waitingWindow.closeCalls).toBe(1)
    await expect(flowPromise).resolves.toEqual(session)
    // No second window opens on a clean success.
    expect(FakeBrowserWindow.instances).toHaveLength(1)
  })
})
