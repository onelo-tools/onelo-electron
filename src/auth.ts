import { generateCodeVerifier, generateCodeChallenge, httpGet, httpPost, checkHostedFlowRequired, mapSession, TOKEN_KEYS } from '@onelo/core'
import type { OneloEntitlement } from '@onelo/core'
import { SecureTokenStorage } from './storage'
import type { OneloElectronConfig, OneloElectronSession, OneloElectronUser, ResolvedSDKConfig } from './types'
import { OneloError } from './types'
import { sdkHeaders } from './sdk-headers'
import { getCachedCodesignFingerprint } from './codesign'
import type { OneloEventStream } from './event-stream'

// ── flowErrorHtml ────────────────────────────────────────────────────────────

/**
 * Graceful error page shown in the auth window when the flow can't be resolved
 * (#31 — e.g. a hard backend reject: attestation / codesign / bundle-id mismatch
 * → 403, or store misconfig). Previously `presentAuthWindow` threw WITHOUT ever
 * opening a window, so a naive host (`await presentAuthWindow(); mainWindow.show()`)
 * hit an UnhandledPromiseRejection and the main window (`show:false`) stayed
 * hidden → blank app. Parity with Flutter `auth_view` `_errorScaffold` (#30) and
 * RN's retry screen.
 *
 * Hard-coded dark #111111 (NOT the branding bg) — matches Flutter's error scaffold
 * and guarantees the white "Try again" button stays legible even if a tenant set a
 * light checkout background. The technical reason is logged to the console (see
 * presentAuthWindow); the on-screen copy stays generic so end users never see a raw
 * "bundle_id_mismatch". The "Try again" button navigates the `onelo-retry://`
 * sentinel, intercepted by `will-navigate` exactly like the deep-link scheme.
 */
function flowErrorHtml(): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;padding:32px;color:rgba(255,255,255,0.92)}
.card{max-width:340px;text-align:center}
.title{font-size:17px;font-weight:600;margin-bottom:8px}
.msg{font-size:13px;line-height:1.5;color:rgba(255,255,255,0.55);margin-bottom:24px}
button{font:inherit;font-size:14px;font-weight:600;padding:11px 24px;border-radius:10px;border:none;background:#ffffff;color:#111111;cursor:pointer}
button:hover{opacity:0.9}
button:focus-visible{outline:2px solid #ffffff;outline-offset:2px}
</style></head><body>
<div class="card">
<div class="title">Couldn't start sign-in</div>
<div class="msg">Something went wrong while connecting. Please check your connection and try again.</div>
<button onclick="location.href='onelo-retry://retry'">Try again</button>
</div>
</body></html>`
}

// ── resolveConfig ────────────────────────────────────────────────────────────

async function resolveConfig(
  publishableKey: string,
  apiUrl: string,
  codeChallenge: string,
  clientSecret?: string
): Promise<ResolvedSDKConfig> {
  if (!publishableKey.startsWith('onelo_pk_')) {
    throw OneloError.invalidKey('Key must start with onelo_pk_')
  }
  const url = `${apiUrl}/api/sdk/config?key=${encodeURIComponent(publishableKey)}&code_challenge=${encodeURIComponent(codeChallenge)}`
  const { status, json } = await httpGet(url, sdkHeaders(
    clientSecret ? { 'X-Client-Secret': clientSecret } : undefined
  ))
  if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
  if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
  const j = json as Record<string, unknown>
  return {
    supabaseUrl: j['supabase_url'] as string,
    supabaseAnonKey: j['supabase_anon_key'] as string,
    tenantId: j['tenant_id'] as string,
    allowCustomBranding: (j['allow_custom_branding'] as boolean) ?? false,
    appName: (j['app_name'] as string | null) ?? null,
    appLogoUrl: (j['app_logo_url'] as string | null) ?? null,
    paywallEnabled: (j['paywall_enabled'] as boolean) ?? false,
    waitlistMode: (j['waitlist_mode'] as boolean) ?? false,
    sdkRedirectUrl: (j['sdk_redirect_url'] as string | null) ?? null,
    storeUrl: (j['store_url'] as string | null) ?? null,
    manageUrl: (j['manage_url'] as string | null) ?? null,
    oauthProviders: (j['oauth_providers'] as string[] | undefined) ?? [],
    // Branding page background (--onelo-page-bg / checkout_bg_color). Required by
    // the shared ResolvedSDKConfig; parity with RN's resolver. Default dark.
    pageBackgroundColor: (j['checkout_bg_color'] as string) || '#111111',
  }
}

/**
 * Is this `?error=` value the hosted page saying its addressing token is spent?
 *
 * NOT a catch-all: a genuine failure must still surface as an error. Reloading
 * on every error would loop forever on one. Exported so the rule is tested
 * directly rather than re-implemented in a test, which would stay green after
 * the behaviour was deleted.
 */
/**
 * How wide a window should a hosted surface get?
 *
 * The store and the portal are laid out as a fixed content column — 432px for
 * the portal, `card_max_width` (360 default) for store cards — which does NOT
 * grow with the viewport. In a browser that column sits centred in whitespace
 * and reads as a modest card. In a 480px window it IS the window: content
 * touches both edges, two and a half cards fit, and everything reads as
 * enormous even though every measured size is exactly what the tenant
 * configured (measured 2026-08-19 — nothing was scaled up, the container was
 * too narrow).
 *
 * Sign-in is different and stays narrow: it is a single 300px form column that
 * looks right in a slim window and lost in a wide one.
 *
 * Decided from the URL rather than a parameter on purpose — `presentHostedUrl`
 * is reached from four call sites including the Access Gate deep link, and a
 * parameter is something a fifth one would forget.
 */
export function hostedWindowSize(url: string): { width: number; minWidth: number } {
  let path = ''
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    // Unparsable: the narrow default is the safe answer — it is what every
    // surface used before this existed.
    return { width: 480, minWidth: 440 }
  }
  const isWideSurface = path.startsWith('/store/') || path.startsWith('/customer/portal')
  return isWideSurface ? { width: 780, minWidth: 560 } : { width: 480, minWidth: 440 }
}

export function isExpiredAuthError(err: string | null | undefined): boolean {
  return err === 'invalid_token' || err === 'expired_token' || err === 'token_expired'
}

// ── OneloElectronAuth ────────────────────────────────────────────────────────

/** Storage slot for the hosted-surface origin — the trust anchor for a
 *  deep-linked gate URL. Namespaced like the token keys so a `clear()` on
 *  sign-out takes it with everything else. */
const HOSTED_ORIGIN_KEY = 'onelo_hosted_origin'

/** How long to wait for the browser round-trip before giving up on a parked
 *  flow. Generous on purpose: a provider sign-in can involve a password, 2FA and
 *  an account chooser. On expiry the flow resolves `null` — "nothing happened",
 *  which is what a caller re-checking real state will conclude anyway. */
const OAUTH_RETURN_TIMEOUT_MS = 5 * 60 * 1000

export class OneloElectronAuth {
  private storage: SecureTokenStorage
  private apiUrl: string
  private publishableKey: string
  private clientSecret: string | undefined
  private protocol: string
  private pkceVerifier: string | null = null
  private resolvedConfig: ResolvedSDKConfig | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly HEARTBEAT_MS = 13 * 60 * 1000
  /** Refresh this many seconds before the access token expires. */
  private static readonly REFRESH_LEAD_SECONDS = 60
  private initPromise: Promise<void>
  private _sessionListeners: Array<(userId: string | null) => void> = []
  /** Incremented on signOut so an in-flight refresh/revalidate can't resurrect a
   *  session that was signed out mid-request (epoch guard — parity with Swift/JS). */
  private signOutEpoch = 0
  /** Whether the app has the paywall enabled — gates the entitlement revalidate
   *  on session restore (only paywall apps care about `hasActiveAccess`). */
  private paywallEnabled = false
  /** App bundle id — sent as X-Bundle-Id on every SDK request. The backend's
   *  validate_sdk_request_security REQUIRES it on live keys for the electron
   *  app_type once a bundle is registered (403 invalid_bundle_id otherwise), and
   *  it gates test-env feature discovery. Threaded to match the sibling modules
   *  (store/forms/waitlist/portal). The /api/sdk/config bootstrap call is the one
   *  exception — it runs before any bundle is known and isn't bundle-gated. */
  private readonly bundleId?: string

  /** True after a hard account revocation (banned / all sessions server-revoked)
   *  surfaced via the SSE `session.revoked` push, heartbeat 401, or refresh
   *  `user_revoked`. Parity with Swift `isUserRevoked` / JS. */
  isUserRevoked = false

  /**
   * Register a callback invoked whenever the session changes (sign-in, restore,
   * or sign-out), receiving the new user id (or `null`). Returns an unsubscribe
   * function. Multi-listener + unsubscribe to match JS `onAuthStateChange`
   * (listener array) and Swift's Combine `currentSession` (multi-observer) — was
   * a single slot that silently overwrote a prior registration. The payload
   * stays `userId: string | null` (the internal Onelo wrapper bridge relies on
   * it to rebind features/monitor identity), NOT the full session object.
   */
  onSessionChange(cb: (userId: string | null) => void): () => void {
    this._sessionListeners.push(cb)
    return () => { this._sessionListeners = this._sessionListeners.filter((l) => l !== cb) }
  }

  /** Fire every registered session listener. Snapshots the array first so a
   *  listener that unsubscribes mid-dispatch doesn't skip its peers, and isolates
   *  a throwing listener so it can never break the auth state machine. */
  private _notifySessionChange(userId: string | null): void {
    for (const l of [...this._sessionListeners]) {
      try { l(userId) } catch { /* a listener must never break auth */ }
    }
  }

  /** True once /api/sdk/config has been fetched successfully */
  isReady = false
  /** True if the publishable key has been revoked */
  isRevoked = false
  /** #29 — non-null when `initialize()` threw; previously swallowed silently
   *  (isReady=false forever with no trace). Surfaced + logged for diagnosis. */
  initError: string | null = null
  /** Whether the tenant's plan allows custom auth UI */
  allowCustomBranding = false
  /** App name from dashboard — shown in hosted sign-in UI */
  appName: string = 'App'
  /** App logo URL from dashboard — shown in hosted sign-in UI if set */
  appLogoUrl: string | null = null
  /** Plan-gated enabled OAuth providers (google/github/apple) from
   *  /api/sdk/config. Empty when social is disabled. Parity with Swift. */
  oauthProviders: string[] = []
  /**
   * Which hosted surface `presentAuthWindow()` last opened: `sign_in`, `store`,
   * `no_plan`, or null when nothing was presented (the caller was already
   * `authorized`, or the flow never got that far).
   *
   * `/api/sdk/flow/init`'s `surface` was read and immediately discarded, so a
   * host app that got `null` back from `presentAuthWindow()` could not tell
   * "user cancelled sign-in" from "user has no plan and closed the no_plan
   * screen" — both close the SAME window the SAME way (`win.on('closed')` →
   * `resolve(null)`). The return type stays `OneloElectronSession | null` —
   * this is additive, reading it is optional. Parity with JS's
   * `lastPresentedSurface`.
   */
  lastPresentedSurface: string | null = null

  constructor(config: OneloElectronConfig) {
    this.storage = new SecureTokenStorage()
    this.protocol = config.protocol ?? 'onelo'
    this.apiUrl = config.apiUrl
    this.publishableKey = config.publishableKey
    this.clientSecret = config.clientSecret
    this.bundleId = config.bundleId
    // #18 DX: X-Bundle-Id is only sent when bundleId is set. A code-SIGNED
    // Electron build without it will be rejected (bundle_id_mismatch 403) on
    // every request once enforcement is active (live app, or an open discovery
    // window with a registered bundle). Surface it LOUDLY at init instead of a
    // silent 403 much later. (Unsigned dev builds aren't enforced, so no noise.)
    if (!this.bundleId && getCachedCodesignFingerprint()) {
      console.warn(
        '[Onelo] This build is code-signed but no `bundleId` is set in your Onelo config. ' +
        'Set `bundleId` to your app id (e.g. "com.company.app") — it is REQUIRED for codesign ' +
        'attestation. Without it, requests are rejected with bundle_id_mismatch (403) once ' +
        'enforcement is active.',
      )
    }
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      const verifier = generateCodeVerifier()
      this.pkceVerifier = verifier
      const challenge = await generateCodeChallenge(verifier)
      const resolved = await resolveConfig(this.publishableKey, this.apiUrl, challenge, this.clientSecret)
      this.resolvedConfig = resolved
      this.allowCustomBranding = resolved.allowCustomBranding
      this.paywallEnabled = resolved.paywallEnabled
      if (resolved.appName) this.appName = resolved.appName
      this.appLogoUrl = resolved.appLogoUrl
      this.oauthProviders = resolved.oauthProviders ?? []
      this.isReady = true
    } catch (e) {
      // #29 — NEVER swallow silently (CLAUDE.md "No silent swallows"). A failed
      // init used to vanish here (isReady=false forever, no trace). Surface it so
      // the real cause reaches the console instead of a mysterious dead SDK.
      const msg = e instanceof Error ? e.message : String(e)
      this.initError = msg
      console.warn(
        '[Onelo] SDK initialization failed — auth and config-gated features are ' +
        'disabled until this is fixed: ' + msg,
      )
      if (e instanceof OneloError && e.code === 'invalid_publishable_key') {
        this.isRevoked = true
      }
      // Otherwise (e.g. transient network) a cached session may still be usable.
    }
  }

  private async waitReady(): Promise<void> {
    await this.initPromise
  }

  /**
   * Resolves when /api/sdk/config has been fetched. Safe to call multiple times.
   * Pass `timeoutSeconds` to reject with `OneloError.timeout` if the SDK isn't
   * ready in time (so startup UI / monitor events don't hang forever on a slow
   * config fetch). No arg = wait indefinitely (back-compat). Parity with Swift
   * `awaitReady(timeout:)` (whose default is 5s — pass 5 to match).
   */
  async whenReady(timeoutSeconds?: number): Promise<void> {
    if (this.isReady) return
    if (timeoutSeconds === undefined) { await this.initPromise; return }
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(OneloError.timeout(`whenReady exceeded ${timeoutSeconds}s`)),
        timeoutSeconds * 1000,
      )
      timer.unref?.()
    })
    try { await Promise.race([this.initPromise, timeout]) }
    finally { clearTimeout(timer!) }
  }

  /**
   * Generate a fresh PKCE verifier AND register its challenge with the backend
   * (GET /api/sdk/config?code_challenge=…), then stash the verifier for the next
   * signin/signup POST. The challenge is single-use — reusing a verifier whose
   * challenge was already consumed (or one whose challenge was never registered)
   * fails the exchange. Called before every signin/signup so retries always work.
   */
  private async _ensurePkce(): Promise<void> {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`
    const { status } = await httpGet(url, sdkHeaders(
      this.clientSecret ? { 'X-Client-Secret': this.clientSecret } : undefined,
    ))
    if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
    if (status !== 200) throw OneloError.server(`Failed to register PKCE challenge: HTTP ${status}`)
    this.pkceVerifier = verifier
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async signIn(email: string, password: string): Promise<OneloElectronSession> {
    await this.waitReady()
    // Register a FRESH, backend-registered PKCE challenge for every attempt. The
    // challenge is single-use (the backend consumes it on exchange), so reusing
    // the init verifier for a 2nd signin — or regenerating a verifier WITHOUT
    // re-registering its challenge — fails with a PKCE mismatch. See _ensurePkce.
    await this._ensurePkce()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signin`,
      {
        email,
        password,
        publishableKey: this.publishableKey,
        code_verifier: this.pkceVerifier,
      },
      sdkHeaders(this.bundleId)
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status === 403) {
      const detail = j['detail'] as Record<string, unknown> | undefined
      if (detail?.['error'] === 'user_revoked') throw OneloError.userRevoked()
      throw OneloError.server((detail?.['message'] ?? j['error']) as string)
    }
    if (status !== 200) throw OneloError.server(`Sign in failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  async signUp(email: string, password: string): Promise<OneloElectronSession> {
    await this.waitReady()
    await this._ensurePkce() // fresh, backend-registered PKCE challenge (see signIn)
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      {
        email,
        password,
        publishableKey: this.publishableKey,
        code_verifier: this.pkceVerifier,
      },
      sdkHeaders(this.bundleId)
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) throw OneloError.server(`Sign up failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  async signOut(): Promise<void> {
    // A sign-out abandons any flow still waiting on the browser; leaving it
    // parked would resolve a caller minutes later, after the world moved on.
    this.settlePendingFlow(null)
    // Bump the epoch BEFORE any await so an in-flight refresh/revalidate can't
    // resurrect the session (epoch guard).
    this.signOutEpoch++
    this.stopHeartbeat()
    this.clearRefreshTimer()
    // Capture the token BEFORE clearing storage — needed for the server revoke.
    const accessToken = await this.storage.get(TOKEN_KEYS.ACCESS_TOKEN)
    await this.storage.clear()
    this._notifySessionChange(null)
    // Revoke server-side so the refresh token can't be reused after logout. The
    // backend soft-revokes ALL of this user's app_sessions + expires portal/store
    // tokens. Fail-open — a network error must never block the local sign-out
    // (already done above). Parity with the JS SDK.
    if (accessToken) {
      try {
        await httpPost(
          `${this.apiUrl}/api/sdk/auth/signout`,
          {},
          sdkHeaders(this.bundleId, { Authorization: `Bearer ${accessToken}`, 'X-Publishable-Key': this.publishableKey }),
        )
      } catch {
        // fail-open — already cleared locally
      }
    }
  }

  /**
   * Instant, SYNCHRONOUS presence check for a locally stored session. Unlike
   * `getSession()` it does NOT await init (`whenReady()`) — no `/api/sdk/config`
   * round-trip — and never touches the network. It is a pure secure-store
   * presence read (access + refresh + user tokens all present), so the host app
   * / window logic can decide AT COLD START, before init resolves, whether a
   * launch is an auto-login (keep the hidden main window hidden while restore
   * runs, or paint the branded auth window) or a genuine signed-out start.
   * Parity with Android `hasStoredSession()` and Swift `hasStoredSessionSync()`
   * (#36).
   *
   * This is an optimistic hint, NOT validation: it does not check token expiry or
   * server-side revocation. Always drive real access off `getSession()` (expiry →
   * refresh) — that enforcement path is unchanged. Mirrors the same three-token
   * completeness check `getSession()` requires before returning a session.
   */
  hasStoredSession(): boolean {
    return this.storage.hasKeysSync(
      TOKEN_KEYS.ACCESS_TOKEN,
      TOKEN_KEYS.REFRESH_TOKEN,
      TOKEN_KEYS.USER_JSON,
    )
  }

  async getSession(): Promise<OneloElectronSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !refreshToken || !userJson) return null
    const expiresAt = parseInt(expiresAtStr ?? '0', 10)
    if (Date.now() / 1000 > expiresAt - 60) {
      return this.refreshSession()
    }
    const user = JSON.parse(userJson) as OneloElectronUser
    if (!user.id) {
      await this.storage.clear()
      return null
    }
    const session: OneloElectronSession = { accessToken, refreshToken, expiresAt, user }
    // Arm background refresh on first read after process start.
    this.scheduleRefresh(session)
    // First read after process start with a restored session — heartbeat not
    // armed yet. Behave like saveSession would on a fresh sign-in: arm the
    // ≤13-min heartbeat revocation backstop AND republish identity, so the
    // onSessionChange bridge rebinds features per-user targeting + monitor userId
    // + opens the SSE stream for this user. Without this, a relaunched app with a
    // stored token would have anonymous features/monitor and NO revocation
    // backstop if SSE is unavailable (429 cap / offline). Mirrors JS getSession
    // restore. The heartbeatTimer===null guard makes it fire exactly once per
    // process (and prevents the getSession→revalidate→getSession recursion, since
    // startHeartbeat arms the timer before revalidate's inner getSession runs).
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken)
      this._notifySessionChange(session.user.id)
      // The stored entitlement may be stale after an external checkout while the
      // app was closed; refresh it once, best-effort (paywall apps only).
      if (this.paywallEnabled) void this.revalidateEntitlement()
    }
    return session
  }

  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess(): Promise<boolean> {
    const session = await this.getSession()
    return session?.user.entitlement === 'active'
  }

  /** A `loadAuthView()`/`presentAuthWindow()` call whose flow LEFT this app for
   *  the system browser and has not come back yet. See `parkPendingFlow`.
   *  `win` is the still-open hosted window it started in — a magic link (like
   *  OAuth) is finished by a deep-link that lands OUTSIDE that window (email
   *  client → system browser → this app's protocol handler), so nothing
   *  in-window ever navigates it away. Tracking it here lets settlePendingFlow
   *  close it once the flow is actually decided, instead of leaving it open as
   *  an orphaned second "Check your inbox" window while a NEW window (the
   *  deep-link's own outcome — success or the no-plan gate) opens next to it. */
  private pendingFlow: { resolve: (s: OneloElectronSession | null) => void; timer: ReturnType<typeof setTimeout>; win: import('electron').BrowserWindow | null } | null = null

  /**
   * Hold the flow open across a hand-off to the system browser — an OAuth
   * provider page, or a magic link opened from the user's email client. Both
   * leave this app's hosted window open (or, for OAuth, about to close) with no
   * in-window navigation to react to; the eventual outcome arrives later via
   * `handleDeepLink`, disconnected from whatever `presentHostedUrl` call is
   * still waiting.
   *
   * It used to resolve `null` at hand-off time, which is the same value the SDK
   * uses for "the user cancelled". A host app therefore could not tell "nothing
   * happened" from "a session is on its way", and the obvious
   * `await loadAuthView(); mainWindow.show()` revealed the app as "Not signed
   * in" while the account chooser was still open in Safari (Adrian, 2026-08-19).
   *
   * Now the promise stays pending until `handleDeepLink` settles it, matching
   * Swift (ASWebAuthenticationSession stays alive) and React Native (the modal
   * stays open). `null` goes back to meaning only "no session came of it".
   */
  private parkPendingFlow(resolve: (s: OneloElectronSession | null) => void, win: import('electron').BrowserWindow | null = null): void {
    // Only one flow can be outstanding; a second hand-off abandons the first.
    this.settlePendingFlow(null)
    const timer = setTimeout(() => this.settlePendingFlow(null), OAUTH_RETURN_TIMEOUT_MS)
    // Never hold the process open on this timer — an app that is quitting must
    // not be kept alive by an abandoned sign-in.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref()
    }
    this.pendingFlow = { resolve, timer, win }
  }

  /** Drop this window's parked entry WITHOUT resolving it — for when the
   *  window is settling itself in-place (e.g. an in-window deep-link code, or
   *  the expired-token reload) and would otherwise leave a stale parked entry
   *  pointing at a window that's already closing. */
  private clearOwnParkedFlow(resolve: (s: OneloElectronSession | null) => void): void {
    if (this.pendingFlow?.resolve !== resolve) return
    clearTimeout(this.pendingFlow.timer)
    this.pendingFlow = null
  }

  /** Complete a parked flow, if there is one. Safe to call unconditionally.
   *  Closes the parked window (if still open) so an out-of-window outcome —
   *  the gate refusal or a real session — never leaves it orphaned next to a
   *  second window presenting that outcome. */
  private settlePendingFlow(session: OneloElectronSession | null): void {
    const parked = this.pendingFlow
    if (!parked) return
    this.pendingFlow = null
    clearTimeout(parked.timer)
    if (parked.win && !parked.win.isDestroyed()) {
      parked.win.removeAllListeners('closed')
      parked.win.close()
    }
    parked.resolve(session)
  }

  /**
   * May this person see the app?
   *
   * READ from the server, never computed here. The rule
   * `!paywallEnabled || entitlement === 'active'` once lived in this SDK, in
   * the JS SDK and in Swift — three copies, each found wrong on a different
   * day. The JS copy answered `true` while its config was still loading, so a
   * plan-less user walked into a paid app on every page load (2026-08-18).
   * `/api/sdk/auth/user` now ships the conclusion so it cannot recur.
   *
   * The fallback is COMPATIBILITY, not a second source of truth: an older
   * backend simply does not send `allowed_in`, and treating absent as `false`
   * would lock every user out of an app running this SDK ahead of the backend.
   * Delete it once the field is everywhere. Note `=== false`: the config flag is
   * only trustworthy once resolved, so anything else must deny.
   *
   * Contract: docs/sdk-access-gate-wiring.md
   */
  async isAllowedIn(): Promise<boolean> {
    const session = await this.getSession()
    if (!session) return false
    const answer = session.user.allowedIn
    if (typeof answer === 'boolean') return answer
    return this.paywallEnabled === false || session.user.entitlement === 'active'
  }

  /**
   * True when this app has the paywall enabled (from `/api/sdk/config`). Lets a
   * launch gate decide whether a session ALONE is enough to enter (non-paywall
   * apps) or whether `hasActiveAccess()` must ALSO hold (paywall apps) — without
   * the developer hardcoding a duplicate flag that could drift from the dashboard.
   * Accurate only after `whenReady()` resolves; returns false before config loads.
   */
  isPaywallEnabled(): boolean {
    return this.paywallEnabled
  }

  /**
   * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
   * + persist the session so `hasActiveAccess()` and the onSessionChange bridge
   * see the new value. Call after an external checkout or on app resume.
   * Best-effort: returns the cached entitlement on any non-200/network failure
   * and never throws (mirrors Swift/JS `revalidateEntitlement`).
   */
  async revalidateEntitlement(): Promise<OneloEntitlement> {
    const epoch = this.signOutEpoch
    const session = await this.getSession()
    if (!session) return 'none'
    try {
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/auth/user`,
        sdkHeaders(this.bundleId, {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Publishable-Key': this.publishableKey,
        }),
      )
      if (status !== 200) return session.user.entitlement
      const body = json as Record<string, unknown>
      const next: OneloEntitlement = body['entitlement'] === 'active' ? 'active' : 'none'
      // Persist the ANSWER too, not only the ingredient. Refreshing entitlement
      // alone left a paying customer holding a stored "not allowed" — locked out
      // by the very call meant to let them in (found in JS/Swift/Flutter,
      // 2026-08-19). Absent stays undefined so the fallback above still applies.
      const nextAllowedIn = typeof body['allowed_in'] === 'boolean'
        ? (body['allowed_in'] as boolean)
        : session.user.allowedIn
      // Don't resurrect a session that was signed out while this request was in
      // flight (epoch guard, parity with Swift/JS).
      const changed = next !== session.user.entitlement || nextAllowedIn !== session.user.allowedIn
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({
          ...session,
          user: { ...session.user, entitlement: next, allowedIn: nextAllowedIn },
        })
      }
      return next
    } catch {
      // Best-effort — never throw; keep the cached value.
      return session.user.entitlement
    }
  }

  /**
   * Wire the shared event stream (called once by `Onelo`). Registers real-time
   * auth pushes: `session.revoked` (server-side force-logout — refund lapse,
   * admin revoke, account deletion, ban → sub-second sign-out, the complement to
   * the ≤13-min heartbeat fallback) and `paywall.access_changed` (a per-user
   * entitlement change → revalidate). Registered once; survives sign-in/out
   * cycles, exactly like the Swift SDK.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('session.revoked', (data) => { void this._handleSessionRevoked(data) })
    stream.on('paywall.access_changed', () => { void this.revalidateEntitlement() })
  }

  /**
   * Handle a `session.revoked` push. Filters to the current user (one app can
   * have multiple buyers multiplexed on the shared stream); a missing
   * `app_user_id` is treated as "current user" (forward-compat). No session →
   * ignore. Teardown mirrors the refresh `user_revoked` path exactly.
   */
  private async _handleSessionRevoked(data: Record<string, unknown>): Promise<void> {
    const userJson = await this.storage.get(TOKEN_KEYS.USER_JSON)
    if (!userJson) return // no active session — nothing to revoke
    let currentUserId: string | undefined
    try { currentUserId = (JSON.parse(userJson) as OneloElectronUser).id } catch { /* treat as current user */ }
    const eventUserId = data['app_user_id']
    if (typeof eventUserId === 'string' && currentUserId && eventUserId !== currentUserId) {
      return // targets a different buyer on this shared connection
    }
    this.signOutEpoch++
    this.stopHeartbeat()
    this.clearRefreshTimer()
    await this.storage.clear()
    this.isUserRevoked = true
    this._notifySessionChange(null)
  }

  async refreshSession(): Promise<OneloElectronSession | null> {
    const epoch = this.signOutEpoch // captured before the network await (see guard below)
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)
    if (!refreshToken) return null
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      sdkHeaders(this.bundleId)
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) {
      // Any non-200 invalidates the session locally. The backend returns the
      // reason in an HTTPException body: { detail: { error | error_code } } —
      // NOT a top-level `error` (the old `j['error'] === 'user_revoked'/'app_revoked'`
      // branches read a shape the backend never sends AND values the /refresh
      // contract never emits, so they were doubly dead). Verified against
      // backend/app/routes/sdk_auth.py refresh handler: session_invalid /
      // session_compromised / session_expired / banned + no_plan_available.
      // Parity with JS _doRefresh auth.ts:473-499 and Swift refreshSession.
      this.clearRefreshTimer(); await this.storage.clear(); this._notifySessionChange(null)
      const detail = j['detail'] as Record<string, unknown> | undefined
      const reason = (detail?.['error'] ?? detail?.['error_code']) as string | undefined
      // Hard account revocation (banned / session server-revoked) → userRevoked.
      if (reason === 'banned' || reason === 'session_compromised') {
        this.isUserRevoked = true
        throw OneloError.userRevoked()
      }
      // No active plan (lapsed) is NOT an account revocation — surface a
      // plan-accurate error so the app routes the buyer to the store/upgrade,
      // never "account suspended" (parity with Swift + JS).
      if (reason === 'no_plan_available') {
        throw OneloError.noActivePlan()
      }
      // benign (session_expired / session_invalid) → just clear + null.
      return null
    }
    // Don't resurrect a session that was signed out while this refresh was in
    // flight (epoch guard — parity with revalidateEntitlement + JS/Swift).
    if (epoch !== this.signOutEpoch) return null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  /**
   * Open the Onelo hosted auth page in an in-app BrowserWindow.
   * Handles the deep-link callback automatically — no app.on('open-url') needed.
   * Works on both free and paid plans. On free plan the hosted page includes Onelo branding.
   *
   * A hard flow-resolve failure (attestation / codesign / bundle-id mismatch →
   * 403, store misconfig, offline) is NOT thrown — it opens a graceful error
   * window with "Try again" and resolves `null` if the user closes it (#31).
   * The ONLY case that still throws is a REVOKED publishable key
   * (`OneloError.invalidKey`) — a permanent developer misconfig where retry is
   * meaningless — so wrap this call in try/catch (the auth-gate snippet does).
   *
   * @param parentWindow  Optional parent BrowserWindow (for modal centering)
   * @throws {OneloError} `invalid_publishable_key` if the app key is revoked.
   */
  async presentAuthWindow(parentWindow?: import('electron').BrowserWindow | null): Promise<OneloElectronSession | null> {
    await this.waitReady()
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')
    let decision: Awaited<ReturnType<typeof this.resolveFlow>>
    try {
      decision = await this.resolveFlow()
    } catch (err) {
      // #31 — resolveFlow throws on a hard backend reject (attestation / codesign
      // / bundle-id mismatch → 403, store misconfig, invalid flow response).
      // Previously this escaped WITHOUT ever opening a window, so a naive host
      // (`await presentAuthWindow(); mainWindow.show()`) hit an
      // UnhandledPromiseRejection and the main window (`show:false`) stayed hidden
      // → blank app. Instead: log the technical reason (never swallow — memory
      // feedback_no_silent_swallows) and open a window with a graceful error +
      // "Try again". Parity with Flutter `_errorScaffold` (#30) / RN retry.
      const reason = err instanceof OneloError ? err.message : String(err)
      console.warn('[Onelo] Auth flow could not be resolved — showing retry UI: ' + reason)
      return this.presentFlowError(parentWindow)
    }
    if (decision.action === 'authorized') {
      // Backend confirmed access via a LIVE entitlement check — do NOT open a
      // window. Sync the cached entitlement so hasActiveAccess() agrees, then
      // return the current session. Parity with JS loadAuthView (auth.ts:166-171)
      // + Swift's `.authorized` case — an already-entitled user no longer gets a
      // redundant sign-in window.
      this.lastPresentedSurface = null
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {})
      return this.getSession()
    }
    // Record WHICH surface is about to open, so a caller reading `null` back
    // from this call can tell "cancelled sign-in" from "closed the no_plan
    // screen" — both close this same window the same way.
    this.lastPresentedSurface = decision.surface || null
    // Remember WHERE Onelo hosts this app's surfaces. The backend just told us,
    // so it is never assembled or assumed — and it is the only thing a
    // deep-linked gate URL can be checked against before being loaded in a
    // window of this app.
    await this.rememberHostedOrigin(decision.url)
    return this.presentHostedUrl(decision.url, parentWindow)
  }

  /** Origin (`host`) serving this app's hosted surfaces, as last named by the
   *  backend. PERSISTED because a magic link can relaunch a killed process: the
   *  deep link then arrives before anything has spoken to the backend, and with
   *  no stored value there would be nothing to check against. */
  private async rememberHostedOrigin(url: string): Promise<void> {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:' || !u.hostname) return
      await this.storage.set(HOSTED_ORIGIN_KEY, u.hostname.toLowerCase())
    } catch {
      // Never fail a sign-in over the anchor. Losing it only costs a fail-closed
      // refusal on a later cold-start deep link, which re-resolves to sign-in.
    }
  }

  /** Is this URL one of Onelo's own hosted surfaces for this app?
   *
   *  Fails CLOSED: an unknown origin, a non-https URL, or no remembered anchor
   *  all answer false. A false negative costs one re-resolve back to sign-in; a
   *  false positive renders an attacker's page inside this app's own sign-in
   *  window, and any process on the machine can hand us a custom-scheme URL. */
  private async isOneloHostedSurface(url: string): Promise<boolean> {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return false
      const known = await this.storage.get(HOSTED_ORIGIN_KEY)
      return !!known && u.hostname.toLowerCase() === known
    } catch {
      return false
    }
  }

  /**
   * Present any Onelo-hosted flow URL (sign-in, store, …) in an in-app
   * BrowserWindow and complete it: a `<protocol>://…?code=` deep-link is
   * exchanged for a session (the user/buyer ends up signed in), while OAuth
   * provider pages are punted to the system browser (RFC 8252 — embedded
   * webviews are blocked/insecure). Resolves with the session, or null if the
   * window closed without a same-window code (e.g. OAuth handed off to the
   * browser — the session then arrives via app.on('open-url') → handleDeepLink).
   * Shared by presentAuthWindow and the store flow (OneloStore).
   */
  async presentHostedUrl(
    hostedUrl: string,
    parentWindow?: import('electron').BrowserWindow | null,
    title?: string,
  ): Promise<OneloElectronSession | null> {
    return new Promise((resolve, reject) => {
      import('electron').then(({ BrowserWindow }) => {
        // Sized from the URL — sign-in stays slim, the store and portal get the
        // room their fixed content column was designed to sit inside.
        const { width: winWidth, minWidth: winMinWidth } = hostedWindowSize(hostedUrl)
        const win = new BrowserWindow({
          // The hosted sign-up form (email + password + confirm + CTA + "Powered
          // by Onelo" footer) is taller than the old fixed 640 → the footer got
          // clipped and a scrollbar appeared. Open tall enough to show every
          // element AND enforce a floor via minWidth/minHeight so it can never be
          // shrunk below the point where content clips (resizable:true is what
          // makes minWidth/minHeight actually bind). Matches the feedback window
          // (720 / min 680) and Swift's 440-min-width.
          width: winWidth,
          height: 720,
          minWidth: winMinWidth,
          minHeight: 680,
          parent: parentWindow ?? undefined,
          modal: !!parentWindow,
          resizable: true,
          minimizable: false,
          maximizable: false,
          // #26 — paint the branding page background (checkout_bg_color, default
          // #111111) so the window doesn't flash white before the hosted page
          // paints. Parity with the customer-portal window (customer-portal.ts).
          backgroundColor: this.resolvedConfig?.pageBackgroundColor ?? '#111111',
          webPreferences: { nodeIntegration: false, contextIsolation: true },
          title: title ?? this.appName ?? 'Sign in',
        })

        // Park from the moment the window opens, not just at the OAuth
        // hand-off below: a magic link is requested by an in-page state
        // change on the hosted page itself (no navigation event fires in
        // `win`), so this is the ONLY point that can observe "this flow may
        // finish outside this window" before it actually does. Harmless for
        // the ordinary in-window code/expired paths below — they clear their
        // own parked entry via clearOwnParkedFlow before resolving directly.
        this.parkPendingFlow(resolve, win)

        win.loadURL(hostedUrl)
        win.setMenuBarVisibility(false)

        // Open target="_blank" links (e.g. "Empowered by Onelo") in system browser
        win.webContents.setWindowOpenHandler(({ url }) => {
          import('electron').then(({ shell }) => shell.openExternal(url))
          return { action: 'deny' }
        })

        // Detect navigations that should NOT happen inside the Electron
        // auth window:
        //
        // 1. Deep-link back to the host app (myapp://callback?code=…) —
        //    that's the OAuth success path. We close the window and hand
        //    the URL to handleDeepLink, which exchanges the one-time code
        //    for a session.
        //
        // 2. OAuth provider authorize pages (github.com/login/oauth,
        //    accounts.google.com/o/oauth2, appleid.apple.com/auth) AND
        //    our own /api/sdk/auth/oauth/{provider} init endpoint that
        //    302s to them. These MUST run in the user's real system
        //    browser, not in our Electron BrowserWindow, because:
        //      • Per RFC 8252 (OAuth 2.0 for Native Apps), embedded
        //        webviews are an anti-pattern — they have no browser
        //        chrome so users can't verify they're on a real provider
        //        page, and providers increasingly detect+block them.
        //      • GitHub specifically returns "redirect_uri is not
        //        associated with this application" when the callback
        //        host has been added on a per-OAuth-app basis but the
        //        embedded webview presents differently than the system
        //        browser the OAuth App was registered against. Even when
        //        it works, the user has no saved GitHub session inside
        //        the embedded view, so they have to re-enter creds + 2FA
        //        every single time.
        //      • Google/Apple actively block known embedded webviews
        //        (User-Agent sniffing) and show "this browser is not
        //        secure" errors.
        //
        //    When we detect (2), we open the URL via shell.openExternal
        //    so the user's system browser takes over. The auth window
        //    here is closed; we don't resolve the Promise yet — instead
        //    the host app's `app.on('open-url', …)` handler will fire
        //    when the OAuth flow comes back via the deep-link scheme, and
        //    that handler is the user's responsibility to wire up via
        //    OneloElectronAuth#handleDeepLink (already documented in
        //    onelo-electron-test/main.js).
        const isOAuthProviderUrl = (url: string): boolean => {
          // The Next.js init route at /api/sdk/auth/oauth/{provider}
          // builds the provider authorize URL and 302s to it. Catching it
          // means the redirect chain happens in the system browser, which
          // also preserves any cached SSO cookies on the provider side.
          if (/\/api\/sdk\/auth\/oauth\/(google|github|apple)(\?|$)/.test(url)) {
            return true
          }
          try {
            const host = new URL(url).host
            return (
              host === 'github.com' ||
              host === 'accounts.google.com' ||
              host === 'appleid.apple.com'
            )
          } catch {
            return false
          }
        }

        const schemePrefix = `${this.protocol.toLowerCase()}://`
        const handleNav = (event: Electron.Event, url: string) => {
          // Lower-cased on BOTH sides: the OS hands the scheme back lower-cased
          // regardless of how it was registered, so a `protocol: 'MyApp'` config
          // made this miss the deep link entirely and the code was lost. Matches
          // the comparison handleDeepLink already does.
          if (url.toLowerCase().startsWith(schemePrefix)) {
            // A hosted surface can hand the window back WITHOUT a code, saying
            // the addressing token is spent: `?error=invalid_token`. That is what
            // "Use a different account" on the no-plan page sends after signing
            // the user out, and what an idle expiry sends. Reloading a FRESH
            // hosted URL is the correct response — the flow is re-resolved
            // server-side and now answers `sign_in`, so the user lands on a clean
            // form instead of this window closing on them with nothing to show.
            // Parity with Swift's `onSessionExpired` (OneloAuthView.swift).
            let expired = false
            try {
              expired = isExpiredAuthError(new URL(url).searchParams.get('error'))
            } catch {
              // Malformed — fall through to the normal path, which returns null.
            }
            if (expired) {
              event.preventDefault()
              this.resolveFlow()
                .then(async (decision) => {
                  if (decision.action === 'present') { win.loadURL(decision.url); return }
                  // `authorized` — the backend just confirmed this caller. Closing
                  // here would trip `win.on('closed')` → resolve(null), telling the
                  // caller "no session" for a user who HAS one. Resolve properly
                  // first, exactly as the top-level authorized branch does.
                  if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {})
                  const session = await this.getSession()
                  this.clearOwnParkedFlow(resolve)
                  win.removeAllListeners('closed')
                  win.close()
                  resolve(session)
                })
                .catch(() => win.close())
              return
            }

            // Deep-link back to the app — success path.
            win.webContents.removeListener('will-redirect', handleNav)
            win.webContents.removeListener('will-navigate', handleNav)
            this.clearOwnParkedFlow(resolve)
            win.removeAllListeners('closed')
            win.close()
            this.handleDeepLink(url)
              .then((session) => {
                if (session) resolve(session)
                else reject(OneloError.server('Auth callback did not return a session'))
              })
              .catch(reject)
            return
          }
          if (isOAuthProviderUrl(url)) {
            // Hand OAuth off to the system browser. Cancel the in-window
            // navigation, open externally, close the auth window. The
            // promise resolves to null — the actual session comes back
            // through app.on('open-url') → handleDeepLink on the host
            // app side.
            event.preventDefault()
            import('electron').then(({ shell }) => shell.openExternal(url))
            win.webContents.removeListener('will-redirect', handleNav)
            win.webContents.removeListener('will-navigate', handleNav)
            // Already parked when this window was opened (see above) — just
            // drop the 'closed' listener so closing it here doesn't resolve
            // null, which is exactly the premature answer parking removes.
            win.removeAllListeners('closed')
            win.close()
          }
        }
        win.webContents.on('will-redirect', handleNav)
        win.webContents.on('will-navigate', handleNav)

        win.on('closed', () => {
          this.clearOwnParkedFlow(resolve)
          resolve(null)
        })
      }).catch(reject)
    })
  }

  /**
   * #31 — Present a graceful error window with a "Try again" button when the auth
   * flow can't be resolved (attestation / codesign / bundle-id mismatch → 403,
   * store misconfig, offline). Called by presentAuthWindow's catch so a hard
   * reject shows UI instead of throwing without a window. Parity with Flutter
   * `_errorScaffold` (#30) and RN's retry screen.
   *
   * Resolves with the eventual session if the user hits "Try again" and the retry
   * succeeds, or `null` if they close the window (same "no session" contract as
   * presentHostedUrl closing without a code).
   */
  private presentFlowError(
    parentWindow?: import('electron').BrowserWindow | null,
  ): Promise<OneloElectronSession | null> {
    return new Promise((resolve, reject) => {
      import('electron').then(({ BrowserWindow }) => {
        const win = new BrowserWindow({
          // Same enforced floor as the hosted auth window (presentHostedUrl) so the
          // error/retry state doesn't render in an oddly-sized window.
          width: 480,
          height: 720,
          minWidth: 440,
          minHeight: 680,
          parent: parentWindow ?? undefined,
          modal: !!parentWindow,
          resizable: true,
          minimizable: false,
          maximizable: false,
          // Hard #111111 (NOT branding bg) — the error page is #111111 and the white
          // "Try again" button must stay legible; matches Flutter's error scaffold.
          backgroundColor: '#111111',
          webPreferences: { nodeIntegration: false, contextIsolation: true },
          title: this.appName ?? 'Sign in',
        })

        win.setMenuBarVisibility(false)
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(flowErrorHtml()))
          .catch(() => { if (!win.isDestroyed()) win.close() })

        // "Try again" navigates the onelo-retry:// sentinel (button sets
        // location.href → fires will-navigate, same interception pattern as the
        // deep-link scheme in presentHostedUrl). We re-run the WHOLE flow: close
        // this window and call presentAuthWindow again, chaining its result so the
        // caller's original await settles with the retried outcome. `retrying`
        // stops the 'closed' handler from resolving null when WE close the window.
        let retrying = false
        const onRetry = (event: Electron.Event, url: string): void => {
          if (!url.startsWith('onelo-retry://')) return
          event.preventDefault()
          retrying = true
          win.webContents.removeListener('will-redirect', onRetry)
          win.webContents.removeListener('will-navigate', onRetry)
          win.close()
          this.presentAuthWindow(parentWindow).then(resolve).catch(reject)
        }
        win.webContents.on('will-redirect', onRetry)
        win.webContents.on('will-navigate', onRetry)

        // External links (none expected on the error page, but keep parity — never
        // let a navigation open inside the chromeless window).
        win.webContents.setWindowOpenHandler(({ url }) => {
          import('electron').then(({ shell }) => shell.openExternal(url))
          return { action: 'deny' }
        })

        win.on('closed', () => {
          // User closed the error window without retrying → no session (null),
          // same contract as presentHostedUrl. A retry-triggered close is flagged
          // so it doesn't double-settle the promise.
          if (!retrying) resolve(null)
        })
      }).catch(reject)
    })
  }

  /**
   * Open the Onelo hosted sign-in page in the system default browser.
   * You must call handleDeepLink() from app.on('open-url') to complete the flow.
   *
   * @param onUrl  Optional callback to receive the hosted URL instead of opening it automatically
   */
  async presentHostedSignIn(onUrl?: (url: string) => void): Promise<void> {
    await this.waitReady()
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')
    const decision = await this.resolveFlow()
    if (decision.action === 'authorized') {
      // Already signed in + entitled — nothing to open. Sync cached entitlement
      // so hasActiveAccess() agrees. Parity with presentAuthWindow / JS.
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {})
      return
    }
    if (onUrl) {
      onUrl(decision.url)
    } else {
      const { shell } = await import('electron')
      await shell.openExternal(decision.url)
    }
  }

  /**
   * Resolve the SINGLE next flow step from the backend, sending the current
   * session as a Bearer so /api/sdk/flow/init can decide `authorized` (already
   * signed in + entitled → no UI) vs `present` (open the hosted sign-in OR store
   * URL). This REPLACES the old always-present `/api/sdk/auth/initiate` — the
   * sign-in↔store↔content routing now lives once, behind Onelo's walls (parity
   * with Swift `resolveFlow` and JS `auth.ts:197`). Waitlist mode is surfaced as
   * a `present` so callers open it exactly like any hosted URL.
   */
  private async resolveFlow(): Promise<{ action: 'authorized' } | { action: 'present'; surface: string; url: string }> {
    if (this.resolvedConfig?.waitlistMode && this.resolvedConfig.sdkRedirectUrl) {
      return { action: 'present', surface: 'waitlist', url: this.resolvedConfig.sdkRedirectUrl }
    }
    const session = await this.getSession()
    const extra: Record<string, string> = {}
    // Same Bearer pattern the SDK already uses for GET /api/sdk/auth/user
    // (revalidateEntitlement); CORS on /api/sdk/* already allows Authorization.
    if (session?.accessToken) extra['Authorization'] = `Bearer ${session.accessToken}`
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.protocol)}`,
      sdkHeaders(this.bundleId, extra),
    )
    if (status !== 200) {
      // Surface the backend's reason (e.g. "store_not_configured", "Invalid
      // publishable key") instead of a bare status — a dev with a paywall on but
      // no store options built needs to see WHY the flow failed.
      const detail = (json as Record<string, unknown> | null)?.['detail']
      const reason = typeof detail === 'string' ? detail : `HTTP ${status}`
      throw OneloError.server(`Failed to resolve auth flow: ${reason}`)
    }
    const j = json as Record<string, unknown>
    if (j['action'] === 'authorized') return { action: 'authorized' }
    if (j['action'] === 'present' && typeof j['url'] === 'string') {
      if (j['app_name']) this.appName = j['app_name'] as string
      if (j['app_logo_url']) this.appLogoUrl = j['app_logo_url'] as string
      return { action: 'present', surface: String(j['surface'] ?? ''), url: j['url'] as string }
    }
    throw OneloError.server('Invalid flow response')
  }

  /**
   * Handle a deep link URL from the OS open-url event.
   * Call this from your app's `open-url` handler (app.on('open-url', ...)).
   * Returns the session if the URL contains a valid auth code, null otherwise.
   */
  async handleDeepLink(url: string): Promise<OneloElectronSession | null> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      // Hosts funnel EVERY incoming url through here (`app.on('open-url')`,
      // `second-instance`), so a malformed one must be ignored, not thrown at.
      return null
    }

    // Smuggling guard — parity with Swift `handleAuthCallback` and Android
    // `Onelo.handleRedirect`, both of which require the canonical
    // `<scheme>://callback` shape. Without it ANY page could navigate to
    // `myapp://anything?code=…` and push a foreign one-time code into the
    // exchange below; the protocol is registered to this app, so the OS delivers
    // it. Scheme comparison is case-insensitive because the OS may hand the
    // scheme back lower-cased regardless of how it was registered.
    //
    // `URL` keeps the trailing colon on `protocol` ("myapp:") and puts the
    // authority in `hostname` for a custom scheme.
    const scheme = this.protocol.replace(/:$/, '').toLowerCase()
    if (parsed.protocol.replace(/:$/, '').toLowerCase() !== scheme) return null
    if (parsed.hostname.toLowerCase() !== 'callback') return null

    // ── A refusal, not a sign-in ────────────────────────────────────────────
    // A sign-in that finishes OUTSIDE this app — a magic link opened in the
    // system browser — can be turned down by the Access Gate, and then there is
    // deliberately no code: the backend withholds it rather than let the app
    // decide. The refusal still has to REACH the app, or it is only ever visible
    // in the browser tab while the app waits on "Check your inbox" forever
    // (Turingo/Swift, 2026-08-19 — same contract, same failure).
    //
    // Nothing here reads or branches on the URL: WHICH screen it is, and what it
    // says, was settled server-side. Presented standalone (`null` parent) —
    // there is no main window to attach to on a cold start.
    const gate = parsed.searchParams.get('gate')
    if (gate) {
      if (!(await this.isOneloHostedSurface(gate))) {
        console.warn('[Onelo] refused a gate URL from an unknown origin')
        this.settlePendingFlow(null)
        return null
      }
      // Settle the parked flow FIRST, with no session: the caller asked "did
      // this sign-in produce access?" and the answer is no. It then re-checks
      // state and keeps the app window hidden, while the surface below explains
      // why. Settling after would leave the caller waiting on a window the user
      // may never close.
      this.settlePendingFlow(null)
      return this.presentHostedUrl(gate, null)
    }

    const code = parsed.searchParams.get('code')
    if (!code) return null // not an auth deep-link — nothing to exchange
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      sdkHeaders(this.bundleId)
    )
    if (status !== 200) {
      // A code WAS present but the exchange failed — surface the backend reason
      // instead of a silent null, so the host app's open-url handler can react
      // (retry / message). Parity with Swift exchangeHostedCode (throws) and JS
      // loadAuthView's hosted-callback error. (No code at all still returns null
      // above — that's "this deep-link isn't ours", not a failure.)
      const detail = (json as Record<string, unknown> | null)?.['detail']
      const reason = typeof detail === 'string' ? detail : `HTTP ${status}`
      // The flow is over, badly. Release the parked caller with "no session"
      // rather than leaving it hanging until the timeout — it re-checks state
      // and keeps the app hidden, which is the right outcome either way. The
      // throw still reaches the host's open-url handler with the real reason.
      this.settlePendingFlow(null)
      throw OneloError.server(`Hosted callback failed: ${reason}`)
    }
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session)
    // Hand the session to whoever is still awaiting the flow this deep link
    // belongs to — the OAuth hand-off parked it when the browser took over.
    this.settlePendingFlow(session)
    return session
  }

  /**
   * Open the Onelo-hosted sign-in page and complete the flow.
   *
   * ALWAYS hosted, on every plan. This used to branch on `allowCustomBranding`
   * and render an inline email/password form the SDK generated itself
   * (`auth-view-html.ts`, deleted 2026-08-19) — so the SAME call produced a
   * different UI depending on the tenant's plan, decided by a server flag rather
   * than by the developer.
   *
   * That inversion made a PAID tenant strictly worse off than a free one. The
   * inline form had no OAuth buttons, no "Forgot password?", no legal consent
   * gate (a developer relying on Onelo for GDPR consent simply did not get it)
   * and received no server-side auth rules, including the Apple App Store
   * sign-up gate. What the plan actually buys is hiding the Onelo footer — which
   * the BACKEND does, on the hosted page.
   *
   * Custom UI is untouched and is a different thing entirely: a developer builds
   * their own screen and calls `signIn()` / `signUp()` directly. Those methods
   * are public and unchanged. What is gone is the SDK substituting a second,
   * lesser UI of its own without being asked.
   *
   * Parity: Swift `OneloAuthView`, Flutter `OneloAuthView`, `@onelo/js`
   * `loadAuthView` — all hosted-only. See docs/sdk-access-gate-wiring.md.
   */
  async loadAuthView(parentWindow?: import('electron').BrowserWindow | null): Promise<OneloElectronSession | null> {
    await this.waitReady()
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')
    return this.presentAuthWindow(parentWindow)
  }

  // NOTE: a legacy `getOAuthUrl()` that called `@supabase/supabase-js`
  // `signInWithOAuth` directly was removed — it bypassed the Onelo backend OAuth
  // broker (BFF pattern) and was dead code (no caller). OAuth is handled by the
  // hosted page via `presentAuthWindow`, which correctly hands the provider
  // authorize URL to the system browser (`/api/sdk/auth/oauth/{provider}`).

  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    await this.waitReady()
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    // NOTE — no `code_challenge` here, deliberately (2026-08-18).
    // Binding a PKCE challenge to a magic link is the RIGHT design, and the
    // backend already supports it. But it cannot ship until the verifier is
    // PERSISTED in a magic-link-specific slot (Keychain / EncryptedSharedPrefs /
    // safeStorage / secure storage), the way Swift's `_beginFlowPKCE` does it.
    // This SDK's `pkceVerifier` is in-memory and is nulled after every password
    // sign-in and regenerated on every launch — and a magic link, by definition,
    // is opened later, often after a relaunch. Sending a challenge against that
    // volatile verifier makes /hosted-callback 401 with "PKCE verification
    // failed", and the link is already marked used at consume, so the user is
    // locked out with no recovery. A challenge-less link is weaker; a burnt link
    // is broken. Also missing: `callback_scheme`, without which the hosted page
    // has no channel to hand the code back to a native client at all.
    const { status } = await httpPost(`${this.apiUrl}/api/sdk/auth/magic-link`, body, sdkHeaders(this.bundleId))
    if (status !== 200) throw OneloError.server(`Magic link request failed: HTTP ${status}`)
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
    await this.waitReady()
    const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
    if (redirectTo) body.redirectTo = redirectTo
    const { status } = await httpPost(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, sdkHeaders(this.bundleId))
    if (status !== 200) throw OneloError.server(`Password reset request failed: HTTP ${status}`)
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async saveSession(session: OneloElectronSession): Promise<void> {
    // Capture the epoch across the awaited writes. signOut()/_handleSessionRevoked
    // bump signOutEpoch synchronously, so if either raced DURING the writes below,
    // we must not resurrect the session: undo the writes and skip re-arming the
    // heartbeat/refresh/onSessionChange side effects. This makes the save atomic
    // w.r.t. sign-out — matching Swift's synchronous saveSession (JS's only
    // interleaving point is the `await`). The pre-save guards in refreshSession/
    // revalidateEntitlement close the network window; this closes the write window.
    const epoch = this.signOutEpoch
    await Promise.all([
      this.storage.set(TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(TOKEN_KEYS.USER_JSON, JSON.stringify(session.user)),
    ])
    if (epoch !== this.signOutEpoch) {
      await this.storage.clear()
      return
    }
    this._notifySessionChange(session.user.id)
    this.startHeartbeat(session.accessToken)
    this.scheduleRefresh(session)
  }

  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  private scheduleRefresh(session: OneloElectronSession): void {
    this.clearRefreshTimer()
    const nowSec = Date.now() / 1000
    const delaySec = session.expiresAt - nowSec - OneloElectronAuth.REFRESH_LEAD_SECONDS
    const delayMs = delaySec > 0 ? delaySec * 1000 : 0
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshSession().catch(() => {
        // Errors already handled inside refreshSession (clears storage).
      })
    }, delayMs)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /**
   * Tear down this module's background timers + the identity bridge so the
   * Electron process can exit cleanly. Called by `Onelo.destroy()`. This does
   * NOT sign out (no server revoke, tokens stay in storage) — it only stops the
   * SDK's own `setInterval`/`setTimeout` and drops the single-slot session
   * callback so it can't re-drive features/monitor after teardown. Parity with
   * JS `Onelo.destroy()` (authUnsubscribe + stopped timers).
   */
  dispose(): void {
    this.stopHeartbeat()
    this.clearRefreshTimer()
    this._sessionListeners = []
  }

  private startHeartbeat(accessToken: string): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(async () => {
      const session = await this.getSession()
      if (!session) { this.stopHeartbeat(); return }
      try {
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
        // The backend heartbeat is a validity probe: it returns 401 when the
        // account is revoked/banned OR every session was server-revoked (account
        // deletion, refund-induced logout, admin force-logout). Act on it —
        // otherwise the user stays "logged in" until the token TTL. This is the
        // documented fallback for exactly when SSE is unavailable (firewall, the
        // 429 connection cap, offline→online). ONLY 401 signs out; other statuses
        // (204 ok, 5xx) fail open, matching the backend's own fail-open behavior.
        // Parity with JS auth.ts:563-569 and Swift OneloAuth.swift:1586-1593.
        if (res.status === 401) {
          this.stopHeartbeat()
          this.clearRefreshTimer()
          await this.storage.clear()
          this.isUserRevoked = true
          this._notifySessionChange(null)
        }
      } catch {
        // Network error — fail-open; the next tick retries.
      }
    }, OneloElectronAuth.HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
