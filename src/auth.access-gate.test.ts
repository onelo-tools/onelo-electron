/**
 * The Access Gate, as this SDK is allowed to know it.
 *
 * Onelo decides; the SDK carries. Contract: docs/sdk-access-gate-wiring.md
 *
 * Both halves are covered here because both were missing: `allowed_in` arrived
 * in the session payload (onelo-core's mapSession has parsed it since
 * 2026-08-18) and nothing read it, and a gate refusal arriving by deep link
 * died in `handleDeepLink` because it carries no `code`.
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

const cfg = { paywallEnabled: false }
const userResponse: { entitlement: string; allowed_in?: boolean } = { entitlement: 'none' }

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: [],
          paywall_enabled: cfg.paywallEnabled,
        } }
      }
      if (url.includes('/api/sdk/auth/user')) return { status: 200, json: userResponse }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloElectronAuth } from './auth'

function makeAuth() {
  return new OneloElectronAuth({
    apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo',
  })
}

/** A stored session carrying whatever the server said about access. */
async function signedIn(auth: OneloElectronAuth, user: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (auth as any).saveSession({
    accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() / 1000 + 3600,
    user: { id: 'u1', role: 'member', tenantId: null, entitlement: 'none', ...user },
  })
}

beforeEach(() => {
  store.clear()
  cfg.paywallEnabled = false
  userResponse.entitlement = 'none'
  delete userResponse.allowed_in
})

describe('isAllowedIn reads the server, not a local rule', () => {
  it('trusts a YES that nothing here could derive', async () => {
    // Contradictory on purpose: paywall on, no entitlement — the old local rule
    // refused. The server may know about a grant this client has not seen, and
    // the server is the one that decides.
    cfg.paywallEnabled = true
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedIn(auth, { entitlement: 'none', allowedIn: true })

    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('honours a NO even when the local flags say otherwise', async () => {
    // No paywall + active entitlement → the old rule said "allowed". Giving a
    // paid product away cannot be undone.
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedIn(auth, { entitlement: 'active', allowedIn: false })

    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('falls back when the backend has not shipped allowed_in yet', async () => {
    // Compatibility, not a second source of truth: without this an app would be
    // locked out the moment the SDK updated ahead of the backend.
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedIn(auth, { entitlement: 'active' })

    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('refuses when nobody is signed in', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('refreshes the ANSWER, not just the entitlement', async () => {
    // The bug this exists to prevent: refreshing entitlement alone left a paying
    // customer holding a stored "not allowed" — locked out by the very call
    // meant to let them in.
    cfg.paywallEnabled = true
    const auth = makeAuth()
    await auth.whenReady(2)
    await signedIn(auth, { entitlement: 'none', allowedIn: false })

    userResponse.entitlement = 'active'
    userResponse.allowed_in = true
    await auth.revalidateEntitlement()

    expect(await auth.isAllowedIn()).toBe(true)
  })
})

describe('a gate refusal arriving by deep link', () => {
  /** Prime the trust anchor exactly as /flow/init does. */
  async function withAnchor(auth: OneloElectronAuth, host = 'st.onelo.tools') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (auth as any).rememberHostedOrigin(`https://${host}/auth/hosted?token=x`)
  }

  it('presents a surface on the origin the BACKEND named', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await withAnchor(auth)
    const spy = vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.handleDeepLink(
      'turingo://callback?gate=' + encodeURIComponent('https://st.onelo.tools/no-plan/hosted?token=npt_1'),
    )

    expect(spy).toHaveBeenCalledWith('https://st.onelo.tools/no-plan/hosted?token=npt_1', null)
  })

  it('refuses a foreign origin', async () => {
    // Any process on the machine can hand this app a custom-scheme URL, and it
    // is loaded in the app's own sign-in window.
    const auth = makeAuth()
    await auth.whenReady(2)
    await withAnchor(auth)
    const spy = vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.handleDeepLink(
      'turingo://callback?gate=' + encodeURIComponent('https://evil.example.com/no-plan/hosted'),
    )

    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses plain http on the right host', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await withAnchor(auth)
    const spy = vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.handleDeepLink(
      'turingo://callback?gate=' + encodeURIComponent('http://st.onelo.tools/no-plan/hosted'),
    )

    expect(spy).not.toHaveBeenCalled()
  })

  it('fails closed when no origin was ever remembered', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const spy = vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.handleDeepLink(
      'turingo://callback?gate=' + encodeURIComponent('https://st.onelo.tools/no-plan/hosted'),
    )

    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores a gate on a FOREIGN scheme', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    await withAnchor(auth)
    const spy = vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)

    await auth.handleDeepLink(
      'otherapp://callback?gate=' + encodeURIComponent('https://st.onelo.tools/no-plan/hosted'),
    )

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('a flow that leaves for the system browser stays open', () => {
  /**
   * `loadAuthView()` used to resolve `null` the moment OAuth was handed to the
   * browser — the same value it uses for "the user cancelled". A host app could
   * not tell those apart, so the obvious `await loadAuthView(); show()` revealed
   * the app as "Not signed in" while the Google account chooser was still open
   * (Adrian, 2026-08-19). The promise now waits for `handleDeepLink`.
   */
  function parkedFlow(auth: OneloElectronAuth) {
    let settled: unknown = 'PENDING'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(auth as any).parkPendingFlow((s: unknown) => { settled = s })
    return () => settled
  }

  it('does not answer before the browser comes back', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const result = parkedFlow(auth)

    await new Promise((r) => setTimeout(r, 10))

    expect(result()).toBe('PENDING')
  })

  it('hands the session over when the deep link lands', async () => {
    const auth = makeAuth()
    await auth.whenReady(2)
    const result = parkedFlow(auth)

    const session = {
      accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() / 1000 + 3600,
      user: { id: 'u1', role: 'member', tenantId: null, entitlement: 'none' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(auth as any).settlePendingFlow(session)

    expect(result()).toBe(session)
  })

  it('releases the caller when a gate refusal arrives instead of a session', async () => {
    // A refusal is an ANSWER, not a hang: no session came of the sign-in, so the
    // caller must be told and keep the app window hidden.
    const auth = makeAuth()
    await auth.whenReady(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (auth as any).rememberHostedOrigin('https://st.onelo.tools/auth/hosted?token=x')
    vi.spyOn(auth, 'presentHostedUrl').mockResolvedValue(null)
    const result = parkedFlow(auth)

    await auth.handleDeepLink(
      'turingo://callback?gate=' + encodeURIComponent('https://st.onelo.tools/no-plan/hosted?token=npt_1'),
    )

    expect(result()).toBeNull()
  })

  it('releases the caller when signing out', async () => {
    // Otherwise an abandoned sign-in resolves minutes later, after the world
    // moved on.
    const auth = makeAuth()
    await auth.whenReady(2)
    const result = parkedFlow(auth)

    await auth.signOut()

    expect(result()).toBeNull()
  })

  it('never parks two flows at once', async () => {
    // A second hand-off abandons the first rather than leaking it forever.
    const auth = makeAuth()
    await auth.whenReady(2)
    const first = parkedFlow(auth)
    const second = parkedFlow(auth)

    expect(first()).toBeNull()
    expect(second()).toBe('PENDING')
  })
})
