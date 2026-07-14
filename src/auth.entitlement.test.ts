import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory storage so getSession / saveSession / clear behave like the real
// secure store (each `new SecureTokenStorage()` gets its own map).
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

// Mutable holder so a test can control what /auth/user returns.
const userEndpoint = { status: 200 as number, entitlement: 'none' as string }

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: { tenant_id: 't1', allow_custom_branding: false, paywall_enabled: true } }
      }
      if (url.includes('/api/sdk/auth/user')) {
        return { status: userEndpoint.status, json: { entitlement: userEndpoint.entitlement } }
      }
      return { status: 200, json: {} }
    }),
    httpPost: vi.fn().mockResolvedValue({ status: 204, json: {} }),
  }
})

import { OneloElectronAuth } from './auth'

const FUTURE = Math.floor(Date.now() / 1000) + 3600
function seededSession(entitlement: 'active' | 'none') {
  return {
    accessToken: 'tok', refreshToken: 'rtok', expiresAt: FUTURE,
    user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement },
  }
}

async function makeAuth() {
  const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
  await auth.whenReady()
  return auth
}

describe('OneloElectronAuth entitlement', () => {
  beforeEach(() => { userEndpoint.status = 200; userEndpoint.entitlement = 'none' })

  it('isPaywallEnabled reflects /api/sdk/config (paywall_enabled) after whenReady', async () => {
    // The mocked config returns paywall_enabled: true — the launch gate reads this
    // to decide whether a session ALONE grants entry or hasActiveAccess must hold.
    const auth = await makeAuth()
    expect(auth.isPaywallEnabled()).toBe(true)
  })

  it('hasActiveAccess reflects the persisted entitlement (no network)', async () => {
    const auth = await makeAuth()
    await (auth as any).saveSession(seededSession('active'))
    expect(await auth.hasActiveAccess()).toBe(true)
    await auth.signOut()
    expect(await auth.hasActiveAccess()).toBe(false) // no session → false
  })

  it('revalidateEntitlement upgrades a stale "none" to "active" and persists it', async () => {
    const auth = await makeAuth()
    await (auth as any).saveSession(seededSession('none'))
    userEndpoint.entitlement = 'active'
    const next = await auth.revalidateEntitlement()
    expect(next).toBe('active')
    expect(await auth.hasActiveAccess()).toBe(true) // persisted
  })

  it('revalidateEntitlement is best-effort: keeps cached value on non-200', async () => {
    const auth = await makeAuth()
    await (auth as any).saveSession(seededSession('active'))
    userEndpoint.status = 500
    expect(await auth.revalidateEntitlement()).toBe('active') // unchanged
  })

  it('restore: getSession arms the heartbeat + republishes identity exactly once', async () => {
    const auth = await makeAuth()
    await (auth as any).saveSession(seededSession('none'))
    ;(auth as any).stopHeartbeat() // simulate a fresh process: tokens persisted, no timer
    const changes: (string | null)[] = []
    auth.onSessionChange((id) => changes.push(id))

    await auth.getSession()
    expect((auth as any).heartbeatTimer).not.toBeNull() // ≤13-min revocation backstop armed
    expect(changes).toContain('u1')                     // identity republished (features/monitor/SSE rebind)

    changes.length = 0
    await auth.getSession()
    expect(changes).toEqual([])                          // second read does NOT re-republish
    ;(auth as any).stopHeartbeat()
  })

  it('epoch guard: a signOut during an in-flight revalidate does not resurrect the session', async () => {
    const auth = await makeAuth()
    await (auth as any).saveSession(seededSession('none'))
    userEndpoint.entitlement = 'active'
    const p = auth.revalidateEntitlement()
    await auth.signOut()               // bumps signOutEpoch mid-flight
    await p
    expect(await auth.getSession()).toBeNull() // not re-saved
  })

  it('write-window guard: a signOut DURING saveSession writes undoes the save + skips re-arm', async () => {
    // Narrower race than the network guard above: the pre-save guards pass, then
    // signOut lands while saveSession is awaiting its storage writes. Without the
    // in-saveSession epoch re-check, the heartbeat/onSessionChange side effects
    // would resurrect the session after sign-out.
    const auth = await makeAuth()
    const changes: (string | null)[] = []
    auth.onSessionChange((id) => changes.push(id))
    const savePromise = (auth as any).saveSession(seededSession('active')) // captures epoch, then awaits writes
    await auth.signOut()                                                    // bumps signOutEpoch during the writes
    await savePromise
    expect(await auth.getSession()).toBeNull()          // writes undone
    expect((auth as any).heartbeatTimer).toBeNull()     // heartbeat NOT re-armed
    expect((auth as any).refreshTimer).toBeNull()       // refresh NOT re-scheduled
    expect(changes).not.toContain('u1')                 // identity NOT republished after sign-out
  })
})

describe('OneloElectronAuth session.revoked (SSE)', () => {
  beforeEach(() => { userEndpoint.status = 200; userEndpoint.entitlement = 'none' })

  function fakeStream() {
    const handlers: Record<string, (d: Record<string, unknown>) => void> = {}
    return {
      on: (e: string, h: (d: Record<string, unknown>) => void) => { handlers[e] = h },
      emit: (e: string, d: Record<string, unknown>) => handlers[e]?.(d),
      addParamProvider: vi.fn(), start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), reconnect: vi.fn(),
    }
  }

  it('clears the session + flags isUserRevoked when the push targets the current user', async () => {
    const auth = await makeAuth()
    const changes: (string | null)[] = []
    auth.onSessionChange((id) => changes.push(id))
    const stream = fakeStream()
    auth.attachEventStream(stream as any)
    await (auth as any).saveSession(seededSession('active'))

    stream.emit('session.revoked', { app_user_id: 'u1' })
    await vi.waitFor(async () => { expect(await auth.getSession()).toBeNull() })
    expect(auth.isUserRevoked).toBe(true)
    expect(changes).toContain(null)
  })

  it('ignores a push that targets a different buyer on the shared connection', async () => {
    const auth = await makeAuth()
    const stream = fakeStream()
    auth.attachEventStream(stream as any)
    await (auth as any).saveSession(seededSession('active'))

    stream.emit('session.revoked', { app_user_id: 'someone-else' })
    // Give the async handler a tick; the session must survive.
    await new Promise((r) => setTimeout(r, 0))
    expect(await auth.getSession()).not.toBeNull()
    expect(auth.isUserRevoked).toBe(false)
  })
})
