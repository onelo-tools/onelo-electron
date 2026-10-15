/**
 * #542 — a magic link requested from the hosted sign-in can be opened on
 * another device (#540): the window shows a code, and once it is typed there
 * the hosted page INSIDE this window navigates to `<scheme>://callback?code=`.
 * Opened on this computer, the same URL returns through the OS protocol
 * handler (`open-url` / `second-instance` → `handleDeepLink`), possibly after
 * the app was quit. Pairing switches on only when the flow token carries a
 * `code_challenge`, so `/flow/init` must send one, and its verifier must
 * survive a relaunch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'

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

const { store, flowInit, callback } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  flowInit: { urls: [] as string[] },
  callback: { value: null as null | { status: number; json: Record<string, unknown> } },
}))

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal: vi.fn(async () => true) },
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => { store.clear() }),
  })),
}))

const SESSION_JSON = {
  access_token: 'at', refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenant_id: null, entitlement: 'none' },
}

const { httpPostMock } = vi.hoisted(() => ({ httpPostMock: vi.fn() }))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return {
          status: 200,
          json: { supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't', allow_custom_branding: false, oauth_providers: [], paywall_enabled: false },
        }
      }
      if (url.includes('/api/sdk/flow/init')) {
        flowInit.urls.push(url)
        return { status: 200, json: { action: 'present', surface: 'sign_in', url: 'https://st.onelo.tools/auth/hosted?token=art_1' } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: httpPostMock,
  }
})

import { TOKEN_KEYS } from '@onelo/core'
import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
}

function s256(v: string): string {
  return createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function waitForWindows(count: number): Promise<void> {
  for (let i = 0; i < 500 && FakeBrowserWindow.instances.length < count; i++) {
    await new Promise((r) => setTimeout(r, 1))
  }
  expect(FakeBrowserWindow.instances).toHaveLength(count)
}

const exchanges = () => httpPostMock.mock.calls.filter((c) => String(c[0]).includes('/hosted-callback'))

beforeEach(() => {
  FakeBrowserWindow.instances = []
  store.clear()
  flowInit.urls = []
  callback.value = null
  httpPostMock.mockReset()
  httpPostMock.mockImplementation(async (url: string) => {
    if (url.includes('/hosted-callback')) return callback.value ?? { status: 200, json: SESSION_JSON }
    return { status: 200, json: {} }
  })
})

afterEach(() => {
  const open = FakeBrowserWindow.instances.filter((w) => !w.destroyed)
  for (const w of open) w.close()
  expect(open, 'a window was left open past the end of its test').toHaveLength(0)
})

describe('#542 hosted flow is bound to a persisted PKCE verifier', () => {
  it('sends on /flow/init the S256 challenge of a verifier kept in secure storage', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const pending = auth.presentAuthWindow()
    await waitForWindows(1)

    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    expect(stored, 'verifier persisted').toBeTruthy()
    expect(new URL(flowInit.urls[0]).searchParams.get('code_challenge')).toBe(s256(stored!))

    FakeBrowserWindow.instances[0].close()
    await expect(pending).resolves.toBeNull()
  })

  it('a paired return inside the window is blocked from the OS and exchanged once with that verifier', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const pending = auth.presentAuthWindow()
    await waitForWindows(1)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    const win = FakeBrowserWindow.instances[0]

    const event = { preventDefault: vi.fn() }
    for (const cb of win.webContents.listeners.get('will-navigate') ?? []) cb(event, 'turingo://callback?code=paired')

    const session = await pending
    expect(session?.user.id).toBe('u1')
    expect(event.preventDefault, 'the OS must not get the callback a second time').toHaveBeenCalled()
    expect(exchanges()).toHaveLength(1)
    expect(exchanges()[0][1]).toMatchObject({ code: 'paired', code_verifier: stored })
    expect(store.has(TOKEN_KEYS.MAGIC_LINK_VERIFIER), 'single use').toBe(false)
    expect(win.destroyed).toBe(true)
  })

  it('a same-device return through the protocol handler settles the waiting window with the flow verifier', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const pending = auth.presentAuthWindow()
    await waitForWindows(1)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)

    // The window sits in the background on "Check your inbox"; the link opened in the browser.
    const direct = await auth.handleDeepLink('turingo://callback?code=same-device')

    expect(direct?.user.id).toBe('u1')
    await expect(pending).resolves.toMatchObject({ user: { id: 'u1' } })
    expect(exchanges()[0][1]).toMatchObject({ code: 'same-device', code_verifier: stored })
    expect(FakeBrowserWindow.instances[0].destroyed).toBe(true)
  })

  it('after a relaunch, the deep link is exchanged with the stored verifier', async () => {
    const first = makeAuth()
    await first.whenReady(2)
    void first.presentAuthWindow()
    await waitForWindows(1)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    FakeBrowserWindow.instances[0].close()

    const relaunched = makeAuth()
    await relaunched.whenReady(2)
    const session = await relaunched.handleDeepLink('turingo://callback?code=after-relaunch')
    expect(session?.user.id).toBe('u1')
    expect(exchanges().at(-1)![1]).toMatchObject({ code: 'after-relaunch', code_verifier: stored })
  })

  it('a missing or mismatched verifier fails once with a clear error and keeps the stored verifier', async () => {
    store.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, 'newer-flow')
    callback.value = { status: 401, json: { detail: 'PKCE verification failed' } }
    const auth = makeAuth()
    await auth.whenReady(2)

    await expect(auth.handleDeepLink('turingo://callback?code=stale')).rejects.toThrow(/different sign-in/i)
    expect(exchanges()).toHaveLength(1)
    expect(store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)).toBe('newer-flow')
  })

  it('the custom-UI sendMagicLink() stays unpaired', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await auth.sendMagicLink('a@b.com')
    const call = httpPostMock.mock.calls.find((c) => String(c[0]).includes('/api/sdk/auth/magic-link'))
    expect(call?.[1]).not.toHaveProperty('code_challenge')
  })
})
