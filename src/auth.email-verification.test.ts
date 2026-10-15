/**
 * #819 — Email Verification in the Electron SDK: the server's answer gates a
 * free app, a refresh after verifying lets the user in, and the resend/confirm
 * calls an App with its own screen uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => { store.clear() }),
  })),
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))

const state = vi.hoisted(() => ({
  userBody: {} as Record<string, unknown>,
  postReply: { status: 200, json: {} as unknown },
  refreshReply: { status: 200, json: {} as unknown },
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: [], paywall_enabled: false,
        } }
      }
      if (url.includes('/api/sdk/auth/user')) return { status: 200, json: state.userBody }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async (url: string) => (url.endsWith('/api/sdk/auth/refresh') ? state.refreshReply : state.postReply)),
  }
})

import { httpPost } from '@onelo/core'
import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
}

async function signedInUnverified(auth: OneloElectronAuth) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (auth as any).saveSession({
    accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() / 1000 + 3600,
    user: {
      id: 'u1', role: 'member', tenantId: null, entitlement: 'none',
      allowedIn: false, emailVerified: false, accessReason: 'email_unverified',
    },
  })
}

beforeEach(() => {
  store.clear()
  state.userBody = {}
  state.postReply = { status: 200, json: {} }
  vi.mocked(httpPost).mockClear()
})

describe('Email Verification (#819)', () => {
  it('keeps an unverified user out of a free app, then lets them in after the refresh', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedInUnverified(auth)
    expect(await auth.isAllowedIn()).toBe(false)

    state.userBody = { entitlement: 'none', allowed_in: true, email_verified: true }
    await auth.revalidateEntitlement()
    expect(await auth.isAllowedIn()).toBe(true)
    const user = (await auth.getSession())?.user
    expect(user?.emailVerified).toBe(true)
    expect(user?.accessReason).toBeUndefined()
  })

  it('resends as the signed-in user', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedInUnverified(auth)
    state.postReply = { status: 200, json: { sent: true, email_verified: false } }
    await expect(auth.resendVerificationEmail()).resolves.toEqual({ sent: true, emailVerified: false })
    const [url, body, headers] = vi.mocked(httpPost).mock.calls.at(-1) as unknown as [string, Record<string, unknown>, Record<string, string>]
    expect(url).toBe('https://api/api/sdk/auth/verify-email/resend')
    expect(body).toEqual({ publishableKey: 'onelo_pk_test' })
    expect(headers.Authorization).toBe('Bearer at')
  })

  it('confirms with the publishable key and maps a dead link', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    state.postReply = { status: 200, json: { email_verified: true } }
    await auth.confirmEmail('tok')
    const [url, body] = vi.mocked(httpPost).mock.calls.at(-1) as unknown as [string, Record<string, unknown>]
    expect(url).toBe('https://api/api/sdk/auth/verify-email/confirm')
    expect(body).toEqual({ publishableKey: 'onelo_pk_test', token: 'tok' })

    state.postReply = { status: 400, json: { detail: { error: 'invalid_token' } } }
    await expect(auth.confirmEmail('old')).rejects.toMatchObject({ code: 'invalid_verification_token' })
  })
})

describe('confirmEmail on a signed-in device (#819)', () => {
  it('refreshes the session — never the 30 s-cached /user — so the app opens at once', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedInUnverified(auth)
    state.userBody = { entitlement: 'none', allowed_in: false, email_verified: false, access_reason: 'email_unverified' }
    state.postReply = { status: 200, json: { email_verified: true } }
    state.refreshReply = { status: 200, json: {
      session: { access_token: 'at2', refresh_token: 'rt2', expires_in: 900 },
      user: { id: 'u1', email: 'u@x.io', entitlement: 'none', allowed_in: true, email_verified: true },
    } }
    await auth.confirmEmail('tok')
    const urls = vi.mocked(httpPost).mock.calls.map((c) => c[0])
    expect(urls.slice(-2)).toEqual(['https://api/api/sdk/auth/verify-email/confirm', 'https://api/api/sdk/auth/refresh'])
    expect(await auth.isAllowedIn()).toBe(true)
    expect((await auth.getSession())?.user.emailVerified).toBe(true)
  })
})
