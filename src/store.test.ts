import { describe, it, expect, vi, beforeEach } from 'vitest'

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async () => true) }))
vi.mock('electron', () => ({ shell: { openExternal } }))

vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn() }
})

import { OneloStore } from './store'
import { httpGet } from '@onelo/core'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

function makeStore(session: unknown) {
  const auth = {
    getSession: vi.fn(async () => session),
    presentHostedUrl: vi.fn(async () => session), // returns the signed-in session
  }
  // Scheme 'MyApp' → lowercased.
  const store = new OneloStore('https://api.example.com', 'onelo_pk_test', auth as any, 'MyApp')
  return { store, auth }
}

describe('OneloStore.initiateStoreFlow()', () => {
  beforeEach(() => { (httpGet as any).mockReset() })

  it('sends the bearer token + lowercased scheme when signed in (re-purchase)', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { store_url: 'https://onelo.tools/store/x' } })
    expect(await store.initiateStoreFlow()).toBe('https://onelo.tools/store/x')
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toContain('/api/sdk/paywall/store-initiate')
    expect(url).toContain('callback_scheme=myapp')
    expect(url).toContain('lang=en')
    expect(headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('omits the bearer token when anonymous (cold-start purchase)', async () => {
    const { store } = makeStore(null)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { store_url: 'https://onelo.tools/store/x' } })
    await store.initiateStoreFlow()
    const [, headers] = (httpGet as any).mock.calls[0]
    expect(headers.Authorization).toBeUndefined()
  })

  it('maps 401 to invalid_publishable_key', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 401, json: {} })
    await expect(store.initiateStoreFlow()).rejects.toMatchObject({ code: 'invalid_publishable_key' })
  })

  it('surfaces the backend error code on 409 store_not_configured (no window should open)', async () => {
    const { store } = makeStore(SESSION)
    // Real FastAPI shape: HTTPException → { detail }.
    ;(httpGet as any).mockResolvedValue({ status: 409, json: { detail: 'store_not_configured' } })
    await expect(store.initiateStoreFlow()).rejects.toThrow(/store_not_configured/)
  })

  it('throws when the response has no store_url', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: {} })
    await expect(store.initiateStoreFlow()).rejects.toThrow(/store_url/)
  })
})

describe('OneloStore.open() / openInBrowser()', () => {
  beforeEach(() => { (httpGet as any).mockReset(); openExternal.mockClear() })

  it('open() presents the store_url via auth.presentHostedUrl and returns the session', async () => {
    const { store, auth } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { store_url: 'https://onelo.tools/store/x' } })
    const parent = { id: 'win' } as any
    const result = await store.open(parent)
    expect(auth.presentHostedUrl).toHaveBeenCalledWith('https://onelo.tools/store/x', parent, 'Store')
    expect(result).toBe(SESSION)
  })

  it('openInBrowser() opens the store_url in the system browser', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { store_url: 'https://onelo.tools/store/x' } })
    await store.openInBrowser()
    expect(openExternal).toHaveBeenCalledWith('https://onelo.tools/store/x')
  })
})

describe('OneloStore.openUpgrade()', () => {
  beforeEach(() => { (httpGet as any).mockReset(); openExternal.mockClear() })

  it('throws not_authenticated with no session and never hits the network', async () => {
    const { store } = makeStore(null)
    await expect(store.openUpgrade('pro')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('sends plan + bearer and opens the upgrade_url in the system browser', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { upgrade_url: 'https://onelo.tools/upgrade/x', target: 'store_switch' } })
    await store.openUpgrade('pro')
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toContain('/api/sdk/paywall/upgrade-initiate')
    expect(url).toContain('plan=pro')
    expect(url).toContain('callback_scheme=myapp')
    expect(headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(openExternal).toHaveBeenCalledWith('https://onelo.tools/upgrade/x')
  })

  it('maps 401 to not_authenticated', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 401, json: {} })
    await expect(store.openUpgrade('pro')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('surfaces the backend error code on 404 plan_not_purchasable', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 404, json: { detail: 'plan_not_purchasable' } })
    await expect(store.openUpgrade('ghost')).rejects.toThrow(/plan_not_purchasable/)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('throws when the response has no upgrade_url', async () => {
    const { store } = makeStore(SESSION)
    ;(httpGet as any).mockResolvedValue({ status: 200, json: { target: 'store' } })
    await expect(store.openUpgrade('pro')).rejects.toThrow(/upgrade_url/)
  })
})
