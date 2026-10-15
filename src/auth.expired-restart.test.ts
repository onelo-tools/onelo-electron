/**
 * #625 — a hosted sign-in window left open past the 5-minute life of its `art_`
 * flow token. The page never revives a dead token; it navigates to
 * `<protocol>://callback?error=token_expired` (frontend/lib/auth-expiry-handback.ts).
 * The window must stay up and load a NEW hosted URL from /flow/init, never close
 * on the person and never reload the dead one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { flowReply } = vi.hoisted(() => ({
  flowReply: { value: { status: 200, json: {} as Record<string, unknown> } },
}))

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
  loaded: string[] = []
  loadURL(url: string) { this.loaded.push(url) }
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
      if (url.includes('/api/sdk/flow/init')) return flowReply.value
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloElectronAuth } from './auth'

const OLD = 'https://st.onelo.tools/auth/hosted?token=art_old'
const NEW = 'https://st.onelo.tools/auth/hosted?token=art_new'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
}

async function waitForWindows(count: number): Promise<void> {
  for (let i = 0; i < 500 && FakeBrowserWindow.instances.length < count; i++) {
    await new Promise((r) => setTimeout(r, 1))
  }
  expect(FakeBrowserWindow.instances).toHaveLength(count)
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 1))
}

function navigate(win: FakeBrowserWindow, url: string) {
  const event = { preventDefault: vi.fn() }
  for (const cb of win.webContents.listeners.get('will-navigate') ?? []) cb(event, url)
  return event
}

beforeEach(() => {
  FakeBrowserWindow.instances = []
  flowReply.value = { status: 200, json: { action: 'present', surface: 'sign_in', url: NEW } }
})

afterEach(() => {
  const open = FakeBrowserWindow.instances.filter((w) => !w.destroyed)
  expect(open, 'a window was left open past the end of its test').toHaveLength(0)
})

const flowInits = async () => {
  const { httpGet } = await import('@onelo/core')
  return (httpGet as any).mock.calls.filter((c: unknown[]) => String(c[0]).includes('/api/sdk/flow/init'))
}

describe('hosted sign-in handed back as token_expired', () => {
  it('keeps the window and loads a NEW hosted URL from /flow/init', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const before = (await flowInits()).length

    const flow = auth.presentHostedUrl(OLD, null)
    await waitForWindows(1)
    const win = FakeBrowserWindow.instances[0]

    const event = navigate(win, 'turingo://callback?error=token_expired')
    expect(event.preventDefault).toHaveBeenCalled()
    await waitFor(() => win.loaded.includes(NEW))

    expect(win.loaded).toContain(NEW)
    expect((await flowInits()).length).toBe(before + 1)
    expect(win.destroyed).toBe(false)
    expect(FakeBrowserWindow.instances).toHaveLength(1)

    win.close()
    await expect(flow).resolves.toBeNull()
  })

  it('a genuine error is surfaced, not restarted', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const before = (await flowInits()).length

    const outcome = auth.presentHostedUrl(OLD, null).then(() => 'resolved', (e: Error) => e.message)
    await waitForWindows(1)
    const win = FakeBrowserWindow.instances[0]
    navigate(win, 'turingo://callback?error=attest_invalid')

    // The window closes and the caller hears about it — no fresh sign-in page.
    expect(await outcome).toMatch(/did not return a session/)
    expect(win.destroyed).toBe(true)
    expect(win.loaded).not.toContain(NEW)
    expect((await flowInits()).length).toBe(before)
  })
})

describe('#619 a store window whose link died', () => {
  const STORE_OLD = 'https://st.onelo.tools/store/hosted?token=srt_old'
  const STORE_NEW = 'https://st.onelo.tools/store/hosted?token=srt_new'

  it('reopens the store on a fresh link from its own initiate, not /flow/init', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const before = (await flowInits()).length
    const renew = vi.fn(async () => STORE_NEW)

    const flow = auth.presentHostedUrl(STORE_OLD, null, 'Store', renew)
    await waitForWindows(1)
    const win = FakeBrowserWindow.instances[0]

    const event = navigate(win, 'turingo://callback?error=token_expired')
    expect(event.preventDefault).toHaveBeenCalled()
    await waitFor(() => win.loaded.includes(STORE_NEW))

    expect(renew).toHaveBeenCalledTimes(1)
    expect((await flowInits()).length).toBe(before)
    expect(win.destroyed).toBe(false)

    win.close()
    await expect(flow).resolves.toBeNull()
  })

  it('closes when a fresh link cannot be minted', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const flow = auth.presentHostedUrl(STORE_OLD, null, 'Store', async () => { throw new Error('offline') })
    await waitForWindows(1)
    const win = FakeBrowserWindow.instances[0]
    navigate(win, 'turingo://callback?error=token_expired')
    await waitFor(() => win.destroyed)
    expect(win.destroyed).toBe(true)
    await flow.catch(() => null)
  })
})
