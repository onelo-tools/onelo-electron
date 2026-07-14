import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

// Controllable BrowserWindow so the hard-block (no-dismiss) gate can be tested
// without an electron runtime. `close()` fires 'close' (preventable) then
// 'closed' only if not prevented — mirroring real electron semantics.
const { electronBW, electronBV } = vi.hoisted(() => ({
  electronBW: { instances: [] as any[] },
  electronBV: { instances: [] as any[] },
}))
vi.mock('electron', () => {
  class BrowserWindow {
    _wc: Record<string, (...a: any[]) => void> = {}
    _on: Record<string, (...a: any[]) => void> = {}
    _destroyed = false
    _views: any[] = []
    webContents = {
      on: (e: string, f: (...a: any[]) => void) => { this._wc[e] = f },
      // Mirror Electron: after the window is destroyed, touching webContents
      // throws "Object has been destroyed". This is what reproduces the
      // cleanup-in-'closed' crash the fix guards against.
      removeListener: () => { if (this._destroyed) throw new Error('Object has been destroyed') },
      executeJavaScript: async () => {},
      setWindowOpenHandler: () => {},
    }
    focus = vi.fn()
    isDestroyed = () => this._destroyed
    setMenuBarVisibility = () => {}
    loadURL = async () => {}
    // BrowserView overlay host API.
    getContentSize = () => [800, 600]
    addBrowserView = (v: any) => { this._views.push(v) }
    removeBrowserView = (v: any) => { this._views = this._views.filter((x) => x !== v) }
    removeListener = (_e: string, _f: any) => {}
    close = vi.fn(() => {
      let prevented = false
      this._on['close']?.({ preventDefault: () => { prevented = true } })
      // Electron fires 'closed' AFTER destruction, so isDestroyed() is true and
      // webContents is dead inside the 'closed' handler.
      if (!prevented) { this._destroyed = true; this._on['closed']?.() }
    })
    on(e: string, f: (...a: any[]) => void) { this._on[e] = f; return this }
    constructor() { electronBW.instances.push(this) }
  }
  class BrowserView {
    _wc: Record<string, (...a: any[]) => void> = {}
    _destroyed = false
    _bounds: any = null
    webContents = {
      on: (e: string, f: (...a: any[]) => void) => { this._wc[e] = f },
      removeListener: () => {},
      executeJavaScript: async () => {},
      setWindowOpenHandler: () => {},
      loadURL: async () => {},
      focus: vi.fn(),
      isDestroyed: () => this._destroyed,
      destroy: () => { this._destroyed = true },
    }
    setBounds = (b: any) => { this._bounds = b }
    constructor() { electronBV.instances.push(this) }
  }
  return { BrowserWindow, BrowserView, shell: { openExternal: () => {} }, app: { on: () => {} } }
})

import { OneloConsent } from './consent'
import { httpGet, httpPost } from '@onelo/core'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function req(overrides: Record<string, unknown> = {}) {
  return {
    doc_type: 'terms', version_id: 'v-123', version: '2026-06-01',
    enforcement: 'block', blocking: true,
    url: 'https://app/legal/t/a/terms', consent_url: 'https://app/legal/t/a/terms?gate=1',
    ...overrides,
  }
}

function makeConsent(session: unknown, autoPresent = true) {
  const auth = { getSession: vi.fn(async () => session), signOut: vi.fn(async () => {}) }
  const consent = new OneloConsent('https://api.example.com', 'onelo_pk_test', auth as any, undefined, autoPresent)
  // Stub the actual window presentation — no electron runtime in unit tests.
  const present = vi.spyOn(consent as any, '_presentConsentWindow').mockResolvedValue(undefined)
  return { consent, auth, present }
}

function fakeStream() {
  const handlers: Record<string, (d: Record<string, unknown>) => void> = {}
  return {
    on: (e: string, h: (d: Record<string, unknown>) => void) => { handlers[e] = h },
    emit: (e: string, d: Record<string, unknown> = {}) => handlers[e]?.(d),
  }
}

describe('OneloConsent.requiredConsents()', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('returns [] with no session and never hits the network', async () => {
    const { consent } = makeConsent(null)
    expect(await consent.requiredConsents()).toEqual([])
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('maps wire snake_case → camelCase and sends bearer + publishable-key headers', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const items = await consent.requiredConsents()
    expect(items).toEqual([{
      docType: 'terms', versionId: 'v-123', version: '2026-06-01',
      enforcement: 'block', blocking: true,
      url: 'https://app/legal/t/a/terms', consentUrl: 'https://app/legal/t/a/terms?gate=1',
    }])
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toContain('/v1/sdk/consent/required')
    expect(headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Publishable-Key': 'onelo_pk_test' })
  })

  it('is forward-compat: unknown enforcement → "unknown", missing blocking → false', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({
      status: 200,
      json: { required: [req({ enforcement: 'quantum', blocking: undefined })] },
    })
    const [item] = await consent.requiredConsents()
    expect(item.enforcement).toBe('unknown')
    expect(item.blocking).toBe(false)
  })

  it('drops malformed rows missing version_id', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({
      status: 200,
      json: { required: [req(), req({ version_id: undefined })] },
    })
    expect(await consent.requiredConsents()).toHaveLength(1)
  })

  it('fail-open ([]) on non-200 and on a network throw', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 500, json: {} })
    expect(await consent.requiredConsents()).toEqual([])
    ;(httpGet as any).mockRejectedValue(new Error('offline'))
    expect(await consent.requiredConsents()).toEqual([])
  })
})

describe('OneloConsent.acceptConsent()', () => {
  beforeEach(() => { (httpPost as any).mockReset() })

  it('POSTs { document_version_id } with bearer + pk headers', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpPost as any).mockResolvedValue({ status: 200, json: {} })
    await consent.acceptConsent('v-123')
    const [url, body, headers] = (httpPost as any).mock.calls[0]
    expect(url).toContain('/v1/sdk/consent/accept')
    expect(body).toEqual({ document_version_id: 'v-123' })
    expect(headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Publishable-Key': 'onelo_pk_test' })
  })

  it('throws not_authenticated with no session (no network)', async () => {
    const { consent } = makeConsent(null)
    await expect(consent.acceptConsent('v-1')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(httpPost).not.toHaveBeenCalled()
  })

  it('throws on a non-2xx response', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpPost as any).mockResolvedValue({ status: 500, json: {} })
    await expect(consent.acceptConsent('v-1')).rejects.toThrow(/HTTP 500/)
  })
})

describe('OneloConsent gate claim (single-owner)', () => {
  it('claim succeeds when free or already owned; blocks a second owner', () => {
    const { consent } = makeConsent(SESSION)
    expect(consent.claimConsentGate('A')).toBe(true)
    expect(consent.claimConsentGate('A')).toBe(true)  // idempotent for owner
    expect(consent.claimConsentGate('B')).toBe(false) // taken
    consent.releaseConsentGate('B')                   // not owner → no-op
    expect(consent.claimConsentGate('B')).toBe(false)
    consent.releaseConsentGate('A')                   // owner releases
    expect(consent.claimConsentGate('B')).toBe(true)  // now free
  })
})

describe('OneloConsent SSE (legal.consent_required)', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('bumps consentRevision + notifies observers on the event', async () => {
    const { consent } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [] } })
    const seen: number[] = []
    consent.onConsentRequired((r) => seen.push(r))
    const stream = fakeStream()
    consent.attachEventStream(stream as any)

    stream.emit('legal.consent_required')
    expect(consent.consentRevision).toBe(1)
    expect(seen).toEqual([1])
  })

  it('auto-presents on the event when autoPresent=true', async () => {
    const { consent } = makeConsent(SESSION, true)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const spy = vi.spyOn(consent, 'presentGateIfNeeded')
    const stream = fakeStream()
    consent.attachEventStream(stream as any)
    stream.emit('legal.consent_required')
    expect(spy).toHaveBeenCalled()
  })

  it('does NOT auto-present when autoPresent=false (but still bumps revision)', async () => {
    const { consent } = makeConsent(SESSION, false)
    const spy = vi.spyOn(consent, 'presentGateIfNeeded')
    const stream = fakeStream()
    consent.attachEventStream(stream as any)
    stream.emit('legal.consent_required')
    expect(consent.consentRevision).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('OneloConsent.presentGateIfNeeded()', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('no-ops (false) with no session', async () => {
    const { consent, present } = makeConsent(null)
    expect(await consent.presentGateIfNeeded()).toBe(false)
    expect(present).not.toHaveBeenCalled()
  })

  it('no-ops (false) + releases claim when nothing is blocking', async () => {
    const { consent, present } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req({ blocking: false })] } })
    expect(await consent.presentGateIfNeeded()).toBe(false)
    expect(present).not.toHaveBeenCalled()
    expect((consent as any)._gateOwner).toBeNull()
  })

  it('presents (true) + claims the gate when a blocking doc has a consent_url', async () => {
    const { consent, present } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    expect(await consent.presentGateIfNeeded()).toBe(true)
    expect(present).toHaveBeenCalledTimes(1)
    expect((consent as any)._gateOwner).not.toBeNull()
  })

  it('no-ops (false) when a blocking doc has no consent_url (fail-open)', async () => {
    const { consent, present } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req({ consent_url: null })] } })
    expect(await consent.presentGateIfNeeded()).toBe(false)
    expect(present).not.toHaveBeenCalled()
  })

  it('no-ops (false) when a gate window is already open', async () => {
    const { consent, present } = makeConsent(SESSION)
    ;(consent as any)._gateWindow = { isDestroyed: () => false }
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    expect(await consent.presentGateIfNeeded()).toBe(false)
    expect(present).not.toHaveBeenCalled()
  })

  it('serializes concurrent callers — only ONE window opens (Finding A)', async () => {
    // Two near-simultaneous triggers (sign-in + a buffered SSE push on boot) must
    // not both pass the guard during the requiredConsents() round-trip.
    const { consent, present } = makeConsent(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const [r1, r2] = await Promise.all([consent.presentGateIfNeeded(), consent.presentGateIfNeeded()])
    expect(present).toHaveBeenCalledTimes(1)
    expect([r1, r2].filter(Boolean)).toHaveLength(1) // exactly one presented
  })
})

describe('OneloConsent._handleConsentAction()', () => {
  beforeEach(() => { (httpGet as any).mockReset(); (httpPost as any).mockReset() })

  it('accept records consent then RE-PRESENTS the next stacked blocking doc (Finding B)', async () => {
    const { consent, present } = makeConsent(SESSION)
    const fakeWin = { isDestroyed: () => false, close: vi.fn() } as any
    ;(consent as any)._gateWindow = fakeWin                                    // gate currently open
    // closeGate mirrors the real forceClose: null the handle (so the re-check's
    // guard doesn't see the closing window) + close the window.
    const closeGate = vi.fn(() => { (consent as any)._gateWindow = null; fakeWin.close() })
    ;(httpPost as any).mockResolvedValue({ status: 200, json: {} })            // acceptConsent OK
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req({ version_id: 'v-2' })] } }) // a 2nd blocking doc
    await (consent as any)._handleConsentAction('accept', { versionId: 'v-1' }, closeGate)
    expect((httpPost as any).mock.calls[0][1]).toEqual({ document_version_id: 'v-1' }) // recorded
    expect(closeGate).toHaveBeenCalled()
    expect(present).toHaveBeenCalledTimes(1)                                    // stacked doc re-presented
  })

  it('decline signs the user out', async () => {
    const { consent, auth } = makeConsent(SESSION)
    const fakeWin = { isDestroyed: () => false, close: vi.fn() } as any
    ;(consent as any)._gateWindow = fakeWin
    const closeGate = vi.fn(() => { (consent as any)._gateWindow = null; fakeWin.close() })
    await (consent as any)._handleConsentAction('decline', { versionId: 'v-1' }, closeGate)
    expect(auth.signOut).toHaveBeenCalled()
    expect(closeGate).toHaveBeenCalled()
  })
})

describe('OneloConsent hard block — no-dismiss gate', () => {
  const REQ = {
    docType: 'terms', enforcement: 'block', blocking: true, version: '2026-06-01',
    versionId: 'v-1', url: 'https://app/legal/t/a/terms', consentUrl: 'https://app/legal/t/a/terms?gate=1',
  }

  const fakeParent = { isDestroyed: () => false } as any

  async function presentOverlay(auth: any) {
    const { BrowserWindow } = (await import('electron')) as any
    electronBV.instances.length = 0
    const consent = new OneloConsent('https://api.example.com', 'onelo_pk_test', auth, undefined, true)
    const parent = new BrowserWindow()
    consent.setGateParent(parent)
    const shown = await consent.presentGateIfNeeded()
    return { consent, parent, view: electronBV.instances[0], shown }
  }

  it('OVERLAY: attaches a full-window BrowserView to the app window (fits + blocks)', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const { parent, view, shown } = await presentOverlay(auth)
    expect(shown).toBe(true)
    expect(view).toBeTruthy()
    expect(parent._views).toContain(view)                                  // attached to app window
    expect(view._bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 })  // fills the window
    expect(view.webContents.focus).toHaveBeenCalled()                      // keyboard focus into the gate
  })

  it('OVERLAY: app window closed while up → teardown (no permanent zombie gate)', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const { consent, parent, view } = await presentOverlay(auth)
    expect((consent as any)._gateView).toBe(view)
    // User closes the app's native window → the 'closed' handler must tear down,
    // else _gateView + the claim strand and the gate is suppressed forever.
    parent._on['closed']?.()
    expect(parent._views).not.toContain(view)
    expect((consent as any)._gateView).toBeNull()
    // The gate can present again afterwards (was permanently blocked pre-fix).
    const { BrowserWindow } = (await import('electron')) as any
    const parent2 = new BrowserWindow()
    consent.setGateParent(parent2)
    expect(await consent.presentGateIfNeeded()).toBe(true)
  })

  it('OVERLAY: decline → signOut + teardown (view removed, no window chrome to dismiss)', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const { consent, parent, view } = await presentOverlay(auth)
    view._wc['will-navigate']({ preventDefault() {} }, 'onelo-consent://done?action=decline')
    await flush(); await flush()
    expect(auth.signOut).toHaveBeenCalled()
    expect(parent._views).not.toContain(view)
    expect((consent as any)._gateView).toBeNull()
  })

  it('OVERLAY: accept records consent then re-checks the next stacked doc', async () => {
    ;(httpGet as any)
      .mockResolvedValueOnce({ status: 200, json: { required: [req()] } })
      .mockResolvedValueOnce({ status: 200, json: { required: [] } })
    ;(httpPost as any).mockResolvedValue({ status: 200, json: {} })
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const { consent, view } = await presentOverlay(auth)
    view._wc['will-navigate']({ preventDefault() {} }, 'onelo-consent://done?action=accept')
    await flush(); await flush()
    expect((httpPost as any).mock.calls[0][1]).toEqual({ document_version_id: 'v-123' })
    expect((consent as any)._gateView).toBeNull()  // nothing left blocking
  })

  it('OVERLAY: fail-open tears down on gate load failure (never traps the user)', async () => {
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { required: [req()] } })
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const { consent, parent, view } = await presentOverlay(auth)
    view._wc['did-fail-load'](null, -2, 'ERR', 'https://x', true)
    await flush()
    expect(parent._views).not.toContain(view)
    expect((consent as any)._gateView).toBeNull()
  })

  it('NON-modal gate (no parent registered) stays dismissible + warns', async () => {
    electronBW.instances.length = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
    const consent = new OneloConsent('https://api.example.com', 'onelo_pk_test', auth as any, undefined, true)
    await (consent as any)._presentConsentWindow(REQ, undefined)  // no parent
    const win = electronBW.instances[0]
    // No close veto is armed (would trap a useless floating window otherwise).
    expect(win._on['close']).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('setGateParent'))
    warn.mockRestore()
  })
})
