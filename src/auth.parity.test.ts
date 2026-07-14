import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => {
    const m = new Map<string, string>()
    return {
      get: vi.fn(async (k: string) => m.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { m.set(k, v) }),
      clear: vi.fn(async () => { m.clear() }),
    }
  }),
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))

// Controllable config + capture of httpPost calls.
const cfg = { hang: false, oauthProviders: [] as string[] }
const postCalls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        if (cfg.hang) return new Promise(() => {}) // never resolves
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: cfg.oauthProviders,
        } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async (url: string, body: unknown, headers: Record<string, string>) => {
      postCalls.push({ url, body, headers })
      return { status: 200, json: {} }
    }),
  }
})

import { OneloElectronAuth } from './auth'

beforeEach(() => { cfg.hang = false; cfg.oauthProviders = []; postCalls.length = 0 })

describe('OneloElectronAuth.whenReady(timeout)', () => {
  it('rejects with OneloError.timeout when config never resolves', async () => {
    cfg.hang = true
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await expect(auth.whenReady(0.05)).rejects.toMatchObject({ code: 'timeout' })
  })

  it('resolves (no throw) once ready', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await expect(auth.whenReady(2)).resolves.toBeUndefined()
  })
})

describe('OneloElectronAuth oauthProviders', () => {
  it('exposes oauth_providers from /api/sdk/config', async () => {
    cfg.oauthProviders = ['google', 'github']
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    expect(auth.oauthProviders).toEqual(['google', 'github'])
  })

  it('defaults to [] when the field is absent', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    expect(auth.oauthProviders).toEqual([])
  })
})

describe('OneloElectronAuth.signOut() server-side revoke', () => {
  it('POSTs /api/sdk/auth/signout with the bearer token before clearing', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    await (auth as unknown as { saveSession: (s: unknown) => Promise<void> }).saveSession({
      accessToken: 'AT', refreshToken: 'RT', expiresAt: 9e9,
      user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'none' },
    })
    await auth.signOut()
    const revoke = postCalls.find((c) => c.url.includes('/api/sdk/auth/signout'))
    expect(revoke).toBeDefined()
    expect(revoke?.headers).toMatchObject({ Authorization: 'Bearer AT', 'X-Publishable-Key': 'onelo_pk_test' })
    expect(await auth.getSession()).toBeNull() // local cleared too
  })

  it('does not throw when the revoke call fails (fail-open)', async () => {
    const core = await import('@onelo/core')
    ;(core.httpPost as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'))
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    await (auth as unknown as { saveSession: (s: unknown) => Promise<void> }).saveSession({
      accessToken: 'AT', refreshToken: 'RT', expiresAt: 9e9,
      user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'none' },
    })
    await expect(auth.signOut()).resolves.toBeUndefined()
    expect(await auth.getSession()).toBeNull()
  })

  it('skips the network revoke when there was no session', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady()
    await auth.signOut()
    expect(postCalls.find((c) => c.url.includes('/signout'))).toBeUndefined()
  })
})
