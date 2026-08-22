/**
 * `loadAuthView()` opens the Onelo-hosted page — on EVERY plan.
 *
 * It used to branch on `allowCustomBranding` and render an inline
 * email/password form the SDK generated itself, so the same call produced a
 * different UI depending on a server flag rather than on the developer. The
 * inversion made a PAID tenant strictly worse off than a free one: no OAuth
 * buttons, no "Forgot password?", no legal consent gate (a developer relying on
 * Onelo for GDPR consent simply did not get it) and no server-side auth rules,
 * including the Apple App Store sign-up gate.
 *
 * The branch was deleted on 2026-08-19 and NOTHING covered it — 329 shipped
 * lines with no test, which is also how nobody noticed its preload was never
 * built, leaving the form dead in every published package.
 *
 * Custom UI is a different thing and is untouched: a developer builds their own
 * screen and calls signIn()/signUp() directly. What must not come back is the
 * SDK substituting a lesser UI of its own.
 */
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

const cfg = { allowCustomBranding: false }

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: cfg.allowCustomBranding, oauth_providers: [],
        } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test' })
}

beforeEach(() => { cfg.allowCustomBranding = false })

describe('loadAuthView is hosted-only', () => {
  it('delegates to the hosted window on a FREE plan', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const spy = vi.spyOn(auth, 'presentAuthWindow').mockResolvedValue(null)

    await auth.loadAuthView(null)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('delegates to the SAME hosted window on a PAID plan', async () => {
    // The regression guard. `allowCustomBranding` means the tenant may hide the
    // Onelo footer — which the BACKEND does, on the hosted page. It has never
    // meant "give this tenant a different, lesser sign-in screen".
    cfg.allowCustomBranding = true
    const auth = makeAuth()
    await auth.whenReady(2)
    expect(auth.allowCustomBranding).toBe(true)
    const spy = vi.spyOn(auth, 'presentAuthWindow').mockResolvedValue(null)

    await auth.loadAuthView(null)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('keeps signIn/signUp public, so custom UI still works', () => {
    // Custom UI is the developer building their own screen on these two calls.
    // Removing the SDK's inline form must not have removed that option.
    const auth = makeAuth()
    expect(typeof auth.signIn).toBe('function')
    expect(typeof auth.signUp).toBe('function')
  })
})
