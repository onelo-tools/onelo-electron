/**
 * `lastPresentedSurface` — parity with the JS SDK's field of the same name.
 *
 * `presentAuthWindow()` resolves `null` both when the user cancels sign-in AND
 * when they close a `no_plan` ("No active plan") screen — the SAME window
 * closing the SAME way. Without this field a host app reading `null` back
 * could not tell those two outcomes apart to react differently (e.g. show the
 * sign-in button again vs. an upgrade prompt).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))

const { flow } = vi.hoisted(() => ({ flow: { value: { status: 200, json: {} as Record<string, unknown> } } }))

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
      if (url.includes('/api/sdk/flow/init')) return flow.value
      if (url.includes('/api/sdk/auth/user')) return { status: 200, json: { entitlement: 'none' } }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
}

describe('OneloElectronAuth.lastPresentedSurface', () => {
  beforeEach(() => {
    flow.value = { status: 200, json: {} }
  })

  it('starts null before any flow is presented', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    expect(auth.lastPresentedSurface).toBeNull()
  })

  it('records "no_plan" when the backend presents the no-plan surface', async () => {
    flow.value = { status: 200, json: { action: 'present', surface: 'no_plan', url: 'https://st.onelo.tools/no-plan/hosted' } }
    const auth = makeAuth()
    await auth.whenReady(2)
    vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    const result = await auth.presentAuthWindow(null)

    expect(result).toBeNull()
    // Both a genuine cancel AND this no-plan case resolve null — the field is
    // what tells them apart.
    expect(auth.lastPresentedSurface).toBe('no_plan')
  })

  it('records "sign_in" for a normal sign-in presentation', async () => {
    flow.value = { status: 200, json: { action: 'present', surface: 'sign_in', url: 'https://st.onelo.tools/auth/hosted' } }
    const auth = makeAuth()
    await auth.whenReady(2)
    vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.presentAuthWindow(null)

    expect(auth.lastPresentedSurface).toBe('sign_in')
  })

  it('resets to null on an "authorized" decision — no window is opened at all', async () => {
    flow.value = { status: 200, json: { action: 'present', surface: 'no_plan', url: 'https://st.onelo.tools/no-plan/hosted' } }
    const auth = makeAuth()
    await auth.whenReady(2)
    vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)
    await auth.presentAuthWindow(null)
    expect(auth.lastPresentedSurface).toBe('no_plan')

    // A later call that resolves as already-authorized must clear the stale value.
    flow.value = { status: 200, json: { action: 'authorized' } }
    await auth.presentAuthWindow(null)
    expect(auth.lastPresentedSurface).toBeNull()
  })
})
