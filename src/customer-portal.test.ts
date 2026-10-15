import { describe, it, expect, vi, beforeEach } from 'vitest'

// shell.openExternal for the openInBrowser() path (customer-portal dynamically
// imports 'electron'). vi.hoisted so the mock factory can reference the spy.
const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async () => true) }))
vi.mock('electron', () => ({ shell: { openExternal } }))

vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn() }
})

import { OneloElectronCustomerPortal, classifyPortalNavigation } from './customer-portal'
import { httpGet } from '@onelo/core'
import { BrandSource } from '@onelo/core'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

// Build a portal whose window presentation is stubbed (no real electron import),
// with a fake auth exposing getSession/signOut. Scheme 'MyApp' → lowercased.
function makePortal(session: unknown) {
  const auth = {
    getSession: vi.fn(async () => session), signOut: vi.fn(async () => {}), isUserRevoked: false, brand: new BrandSource(),
    revalidateEntitlement: vi.fn(async () => 'active'),
  }
  const portal = new OneloElectronCustomerPortal('https://api.example.com', 'onelo_pk_test', auth as any, 'MyApp')
  const present = vi.spyOn(portal as any, '_presentPortalWindow').mockResolvedValue(undefined)
  return { portal, auth, present }
}

describe('OneloElectronCustomerPortal.open()', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('throws not_authenticated with no session — and never hits the network', async () => {
    const { portal } = makePortal(null)
    await expect(portal.open()).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('maps a 401 from portal-initiate to not_authenticated', async () => {
    const { portal, present } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 401, json: {} })
    await expect(portal.open()).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(present).not.toHaveBeenCalled()
  })

  it('throws a server error on a non-200 initiate', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 500, json: {} })
    await expect(portal.open()).rejects.toThrow(/HTTP 500/)
  })

  it('throws when the initiate response has no hosted_url', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: {} })
    await expect(portal.open()).rejects.toThrow(/hosted_url/)
  })

  it('opens the window with the hosted_url, lowercases the scheme, and sends the bearer token', async () => {
    const { portal, present } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/portal/xyz' } })
    const parent = { id: 'win' } as any
    await portal.open(parent)

    expect(present).toHaveBeenCalledWith('https://onelo.tools/portal/xyz', parent)
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toContain('/api/sdk/paywall/portal-initiate')
    expect(url).toContain('callback_scheme=myapp')          // 'MyApp' normalized to lowercase
    expect(headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it("open({ intent: 'change_plan' }) opens the portal straight into the plan picker (#606)", async () => {
    const { portal, present } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/customer/portal?token=prt_1' } })
    await portal.open(undefined, { intent: 'change_plan' })
    expect(present).toHaveBeenCalledWith('https://onelo.tools/customer/portal?token=prt_1&intent=change_plan', undefined)
  })

  it('re-reads the entitlement once the portal window closes (#606)', async () => {
    const { portal, auth } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/portal/xyz' } })
    await portal.open()
    expect(auth.revalidateEntitlement).toHaveBeenCalledTimes(1)
  })
})

describe('OneloElectronCustomerPortal.initiate() / openInBrowser()', () => {
  beforeEach(() => { (httpGet as any).mockReset(); openExternal.mockClear() })

  it('initiate() returns the hosted_url (bearer header, lowercased scheme)', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/portal/xyz' } })
    expect(await portal.initiate()).toBe('https://onelo.tools/portal/xyz')
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toContain('callback_scheme=myapp')
    expect(headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('initiate() throws not_authenticated with no session (no network)', async () => {
    const { portal } = makePortal(null)
    await expect(portal.initiate()).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('openInBrowser() opens the hosted_url in the system browser (shell.openExternal)', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/portal/xyz' } })
    await portal.openInBrowser()
    expect(openExternal).toHaveBeenCalledWith('https://onelo.tools/portal/xyz')
  })

  it("openInBrowser({ intent: 'change_plan' }) carries the intent (#606)", async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/customer/portal?token=prt_1' } })
    await portal.openInBrowser({ intent: 'change_plan' })
    expect(openExternal).toHaveBeenCalledWith('https://onelo.tools/customer/portal?token=prt_1&intent=change_plan')
  })
})

describe('OneloElectronCustomerPortal.handlePortalCallback() — hard events', () => {
  it.each(['account_deletion_scheduled', 'account_revoked', 'session_compromised'])(
    'clears the session + flags isUserRevoked on %s',
    async (event) => {
      const { portal, auth } = makePortal(SESSION)
      const handled = await portal.handlePortalCallback(`myapp://callback?source=portal&event=${event}`)
      expect(handled).toBe(true)
      expect(auth.isUserRevoked).toBe(true)
      expect(auth.signOut).toHaveBeenCalled()
    },
  )

  it('ignores a non-portal deep link (returns false, no signOut)', async () => {
    const { portal, auth } = makePortal(SESSION)
    expect(await portal.handlePortalCallback('myapp://callback?source=auth&code=abc')).toBe(false)
    expect(auth.signOut).not.toHaveBeenCalled()
    expect(auth.isUserRevoked).toBe(false)
  })

  it('a portal callback with no/unknown event does not clear the session', async () => {
    const { portal, auth } = makePortal(SESSION)
    expect(await portal.handlePortalCallback('myapp://callback?source=portal')).toBe(true) // is a portal cb
    expect(auth.signOut).not.toHaveBeenCalled()                                             // but no hard event
    expect(auth.isUserRevoked).toBe(false)
  })
})

describe('classifyPortalNavigation() — which portal-window navigations the SDK owns', () => {
  it('a store purchase started from the portal closes the window (#592)', () => {
    expect(classifyPortalNavigation('myapp://callback?code=abc123', 'myapp')).toEqual({ kind: 'checkout_complete' })
  })

  it('the portal return deep-link still carries its event', () => {
    expect(classifyPortalNavigation('myapp://callback?source=portal&event=account_revoked', 'myapp'))
      .toEqual({ kind: 'portal_done', event: 'account_revoked' })
    expect(classifyPortalNavigation('MyApp://callback?source=portal', 'myapp'))
      .toEqual({ kind: 'portal_done', event: null })
  })

  it('a plan switch with no checkout closes the window (#599)', () => {
    expect(classifyPortalNavigation('myapp://callback?source=store&event=switch_scheduled', 'myapp'))
      .toEqual({ kind: 'store_done', reason: 'switch_scheduled' })
  })

  it('a spent store link ("Return to app") closes the window (#606)', () => {
    expect(classifyPortalNavigation('myapp://callback?error=token_expired', 'myapp'))
      .toEqual({ kind: 'store_cancel', error: 'token_expired' })
  })

  it('hosted pages, other schemes and bare callbacks are left alone', () => {
    expect(classifyPortalNavigation('https://st.onelo.tools/store/hosted?token=srt_1&code=x', 'myapp')).toBeNull()
    expect(classifyPortalNavigation('otherapp://callback?code=abc', 'myapp')).toBeNull()
    expect(classifyPortalNavigation('myapp://callback', 'myapp')).toBeNull()
  })
})

// ── #613 / #614 — the hosted portal renews its token through the app ─────────
import { portalRenewRelayScript, portalRenewReplyScript, sameOrigin } from './customer-portal'

describe('portal renewal (#614)', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('classifies the relay sentinel as a renew request, not a close', () => {
    expect(classifyPortalNavigation('myapp://renew-portal?request_id=r1', 'myapp'))
      .toEqual({ kind: 'renew_portal', requestId: 'r1' })
    expect(classifyPortalNavigation('myapp://renew-portal', 'myapp')).toBeNull()
  })

  it('renewReply mints a fresh portal with the current session', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.tools/customer/portal?token=prt_new' } })
    expect(await portal.renewReply('r1')).toEqual({
      type: 'onelo:renewed', request_id: 'r1', hosted_url: 'https://onelo.tools/customer/portal?token=prt_new',
    })
    expect((httpGet as any).mock.calls[0][1]).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('renewReply without a session → not_authenticated, no request', async () => {
    const { portal } = makePortal(null)
    expect(await portal.renewReply('r2')).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('renewReply on a server failure → renew_failed', async () => {
    const { portal } = makePortal(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 500, json: {} })
    expect((await portal.renewReply('r3')).reason).toBe('renew_failed')
  })

  it('the relay forwards only self-posted portal renew requests, and a parked one', () => {
    const script = portalRenewRelayScript('myapp')
    const hrefs: string[] = []
    const listeners: ((e: { source: unknown; data: unknown }) => void)[] = []
    const win: any = {
      __oneloRenewPending: { type: 'onelo:renew_request', kind: 'portal', request_id: 'parked' },
      addEventListener: (_t: string, fn: any) => listeners.push(fn),
      location: { set href(v: string) { hrefs.push(v) } },
    }
    // eslint-disable-next-line no-new-func
    new Function('window', script)(win)
    expect(hrefs).toEqual(['myapp://renew-portal?request_id=parked'])
    listeners[0]({ source: win, data: JSON.stringify({ type: 'onelo:renew_request', kind: 'portal', request_id: 'a b' }) })
    listeners[0]({ source: {}, data: { type: 'onelo:renew_request', kind: 'portal', request_id: 'foreign' } })
    listeners[0]({ source: win, data: { type: 'onelo:ready' } })
    expect(hrefs).toEqual(['myapp://renew-portal?request_id=parked', 'myapp://renew-portal?request_id=a%20b'])
  })

  it('the reply is a self-post of a JSON literal', () => {
    expect(portalRenewReplyScript({ type: 'onelo:renewed', request_id: 'r1', hosted_url: 'u' }))
      .toBe(`window.postMessage({"type":"onelo:renewed","request_id":"r1","hosted_url":"u"}, '*');`)
  })
})

describe('sameOrigin (#614 review N1)', () => {
  it('matches the portal origin, not a foreign page', () => {
    expect(sameOrigin('https://onelo.tools/store/hosted?token=srt_1', 'https://onelo.tools/customer/portal?token=prt_1')).toBe(true)
    expect(sameOrigin('https://checkout.stripe.com/pay', 'https://onelo.tools/customer/portal')).toBe(false)
    expect(sameOrigin('data:text/html,x', 'https://onelo.tools/customer/portal')).toBe(false)
    expect(sameOrigin('', 'https://onelo.tools')).toBe(false)
  })
})
