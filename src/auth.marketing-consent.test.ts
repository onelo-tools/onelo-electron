import { describe, it, expect, vi, beforeEach } from 'vitest'

/** #818 — a custom Electron sign-up screen asks with the /config text, and
 *  signUp sends the ticked consent in the language of that text. */
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

const QUESTION = { asked: true, text: 'Updates from Turingo.', language: 'pl' }
const configUrls: string[] = []
const postCalls: Array<{ url: string; body: Record<string, unknown> }> = []

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        configUrls.push(url)
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: true, oauth_providers: [], signup_marketing_consent: QUESTION,
        } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async (url: string, body: Record<string, unknown>) => {
      postCalls.push({ url, body })
      return { status: 200, json: {
        access_token: 'acc', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'u1', email: 'a@b.c' },
      } }
    }),
  }
})

import { OneloElectronAuth } from './auth'

beforeEach(() => { configUrls.length = 0; postCalls.length = 0 })

describe('OneloElectronAuth — Marketing Consent at sign-up (#818)', () => {
  it('asks /config with a language and exposes the question', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady(2)
    expect(configUrls[0]).toMatch(/[?&]lang=/)
    expect(auth.getSignupMarketingConsent()).toEqual(QUESTION)
  })

  it('sends the ticked consent, and nothing when unticked', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
    await auth.whenReady(2)
    await auth.signUp('a@b.c', 'Passw0rd!x', { marketingConsent: true })
    await auth.signUp('b@b.c', 'Passw0rd!x')
    const signups = postCalls.filter((p) => p.url.endsWith('/api/sdk/auth/signup'))
    expect(signups[0].body).toMatchObject({ marketing_consent: true, lang: 'pl' })
    expect(signups[1].body).not.toHaveProperty('marketing_consent')
  })
})
