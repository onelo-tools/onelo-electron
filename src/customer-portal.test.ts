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

import { OneloElectronCustomerPortal } from './customer-portal'
import { httpGet } from '@onelo/core'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

// Build a portal whose window presentation is stubbed (no real electron import),
// with a fake auth exposing getSession/signOut. Scheme 'MyApp' → lowercased.
function makePortal(session: unknown) {
  const auth = { getSession: vi.fn(async () => session), signOut: vi.fn(async () => {}), isUserRevoked: false }
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
