import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `handleDeepLink` — the smuggling guard.
 *
 * Hosts funnel EVERY incoming url through this method (`app.on('open-url')`,
 * `second-instance`). Until 0.41.0 it parsed any url for `?code=` and exchanged
 * it, with no check on the scheme or the authority. The custom protocol is
 * registered to the app, so a page could navigate to
 * `myapp://anything?code=<code the attacker controls>` and push a foreign
 * one-time code into the exchange. Swift (`handleAuthCallback`) and Android
 * (`Onelo.handleRedirect`) both require the canonical `<scheme>://callback`
 * shape; this pins the same rule here.
 *
 * The rejection paths must return `null` rather than throw: the host cannot
 * pre-filter, so anything else would make wiring `open-url` a trap.
 */
// Storage + codesign are native Electron surfaces with no test double in this
// environment (safeStorage throws). Same stubs the sibling auth tests use.
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('./codesign', () => ({
  getCachedCodesignFingerprint: vi.fn().mockReturnValue(null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const CONFIG_RESPONSE = {
  supabase_url: 'https://test.supabase.co',
  supabase_anon_key: 'anon',
  tenant_id: 't1',
  allow_custom_branding: false,
  app_name: 'App',
  app_logo_url: null,
}

async function makeAuth() {
  mockFetch.mockImplementation((url: string) => {
    if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
    if (url && url.includes('/api/sdk/auth/hosted-callback')) {
      return mockResponse(200, {
        access_token: 'tok', refresh_token: 'ref', token_type: 'bearer', expires_in: 900,
        user: { id: 'u1', email: 'ada@example.com' },
      })
    }
    return mockResponse(404, {})
  })
  const { OneloElectronAuth } = await import('./auth')
  const auth = new OneloElectronAuth({
    publishableKey: 'onelo_pk_test',
    apiUrl: 'https://api.onelo.tools',
    protocol: 'myapp',
  })
  await auth.whenReady()
  return auth
}

function exchangeCalls() {
  return mockFetch.mock.calls.filter((c) => String(c[0]).includes('/hosted-callback'))
}

describe('handleDeepLink — scheme + host guard', () => {
  beforeEach(() => mockFetch.mockReset())

  it('ignores a foreign scheme without exchanging anything', async () => {
    const auth = await makeAuth()
    expect(await auth.handleDeepLink('otherapp://callback?code=abc')).toBeNull()
    expect(exchangeCalls()).toHaveLength(0)
  })

  it('ignores our scheme with the wrong host — the smuggling case', async () => {
    const auth = await makeAuth()
    expect(await auth.handleDeepLink('myapp://anything?code=abc')).toBeNull()
    expect(exchangeCalls()).toHaveLength(0)
  })

  it('ignores a malformed url instead of throwing', async () => {
    // The host cannot pre-filter, so a throw here would crash their open-url handler.
    const auth = await makeAuth()
    expect(await auth.handleDeepLink('not a url')).toBeNull()
    expect(exchangeCalls()).toHaveLength(0)
  })

  it('ignores the canonical shape when it carries no code', async () => {
    // e.g. the portal's `?source=portal` return, which travels the same scheme.
    const auth = await makeAuth()
    expect(await auth.handleDeepLink('myapp://callback?source=portal')).toBeNull()
    expect(exchangeCalls()).toHaveLength(0)
  })

  it('accepts the canonical shape and exchanges the code', async () => {
    const auth = await makeAuth()
    const session = await auth.handleDeepLink('myapp://callback?code=abc')
    expect(session).not.toBeNull()
    expect(exchangeCalls()).toHaveLength(1)
  })

  it('matches the scheme case-insensitively', async () => {
    // The OS may hand the scheme back lower-cased regardless of registration.
    const auth = await makeAuth()
    const session = await auth.handleDeepLink('MYAPP://CALLBACK?code=abc')
    expect(session).not.toBeNull()
    expect(exchangeCalls()).toHaveLength(1)
  })
})
