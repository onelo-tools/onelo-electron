import { httpGet, httpPost } from '@onelo/core'
import { OneloError } from './types'
import { sdkHeaders } from './sdk-headers'
import type { OneloElectronAuth } from './auth'
import type { OneloEventStream } from './event-stream'

/**
 * Legal-consent enforcement level. `block` gates the app until accepted;
 * `notify` is informational. Unknown future values decode to `unknown`
 * (forward-compat — never throws), mirroring Swift's `OneloConsentEnforcement`.
 */
export type OneloConsentEnforcement = 'block' | 'notify' | 'unknown'

/**
 * One legal document the signed-in user has not yet accepted. Shape mirrors
 * Swift's `OneloConsentRequirement` (wire keys are snake_case; see `_mapRequirement`).
 */
export interface OneloConsentRequirement {
  /** Document type: "terms" | "privacy" | "dpa" | "cookies" (open set). */
  docType: string
  /** The version id to POST back on accept (`document_version_id`). */
  versionId: string
  /** Human version label, e.g. "2026-06-01-v2". */
  version: string
  /** `block` | `notify` | `unknown`. */
  enforcement: OneloConsentEnforcement
  /** True iff this document HARD-blocks the app right now (server-computed:
   *  enforcement=block AND effective_at<=now). The single gate signal. */
  blocking: boolean
  /** Read-only document URL (may be null for platform-scope docs). */
  url: string | null
  /** Gate-mode URL (document + accept/decline buttons); loaded in the gate
   *  window. Null for platform-scope docs. */
  consentUrl: string | null
}

/** Internal sentinel the injected relay navigates to so `will-navigate` can
 *  capture the hosted page's `onelo:consent` postMessage. Its own scheme (NOT
 *  the app's deep-link protocol) so it can never collide with a real callback. */
const CONSENT_SENTINEL = 'onelo-consent://done'

/** Injected after the gate page loads: forwards the page's
 *  `postMessage({type:'onelo:consent', action})` into a sentinel navigation the
 *  main process intercepts. Mirrors `feedback.ts`'s relay idiom. */
const POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'onelo:consent' && e.data.action) {
      window.location.href = '${CONSENT_SENTINEL}?action=' + encodeURIComponent(e.data.action);
    }
  });
})();
`

/** Map one wire requirement (snake_case) to the SDK shape. Forward-compat:
 *  unknown enforcement → 'unknown'; missing `blocking` → false (never gate on a
 *  field the server didn't send). Mirrors Swift's soft-decode. */
function _mapRequirement(j: Record<string, unknown>): OneloConsentRequirement | null {
  const versionId = j['version_id']
  const docType = j['doc_type']
  const version = j['version']
  // version_id is load-bearing (POST-back key); drop malformed rows rather than
  // surface a requirement we can't accept.
  if (typeof versionId !== 'string' || typeof docType !== 'string' || typeof version !== 'string') {
    return null
  }
  const rawEnf = j['enforcement']
  const enforcement: OneloConsentEnforcement =
    rawEnf === 'block' || rawEnf === 'notify' ? rawEnf : 'unknown'
  return {
    docType,
    versionId,
    version,
    enforcement,
    blocking: j['blocking'] === true,
    url: typeof j['url'] === 'string' ? j['url'] : null,
    consentUrl: typeof j['consent_url'] === 'string' ? j['consent_url'] : null,
  }
}

/**
 * Legal-consent gate for signed-in users — the Electron port of Swift's
 * `OneloAuth.requiredConsents()`/`acceptConsent()` + `OneloAuthView`'s blocking
 * consent screen.
 *
 * At sign-in, consent is enforced server-side inside the hosted sign-in page.
 * This class covers the OTHER moment: a user who is ALREADY signed in when you
 * publish a new blocking legal version (Terms update). The backend pushes
 * `legal.consent_required` over the shared SSE stream; this class re-checks and,
 * if a blocking document is outstanding, presents the hosted gate page in a
 * BrowserWindow. Accept records consent (and re-checks, since documents stack);
 * decline signs the user out. Fail-open on network errors — the gate exists to
 * surface real blocking updates, not to lock users out on a blip.
 *
 * Usage (automatic, default):
 *   // Onelo wires this to sign-in + the SSE event; nothing to do.
 * Usage (manual, if autoPresentConsentGate:false):
 *   await onelo.consent.presentGateIfNeeded(mainWindow)
 */
export class OneloConsent {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly auth: OneloElectronAuth
  private readonly bundleId?: string
  /** When false, the SSE handler still bumps the revision + notifies observers
   *  but does NOT auto-open the gate window (custom-UI apps drive it themselves). */
  private readonly autoPresent: boolean

  /** Bumped on each `legal.consent_required` SSE push. Observe via
   *  `onConsentRequired` to drive your own UI (parity with Swift's
   *  @Published consentRevision). */
  private _consentRevision = 0
  private readonly revisionListeners = new Set<(revision: number) => void>()

  /** Single-owner gate claim (parity with Swift's consentGateOwner) so that when
   *  several presenters exist only ONE opens a window. */
  private _gateOwner: string | null = null
  /** This instance's stable claim token. */
  private readonly gateToken: string = crypto.randomUUID()
  /** The live gate window, if one is open — prevents opening a second. */
  private _gateWindow: import('electron').BrowserWindow | null = null
  /** The live gate overlay (BrowserView filling the app window), if one is open.
   *  Preferred presentation when a parent window is registered — fits the app
   *  window, resizes with it, blocks input, non-dismissible. The standalone
   *  `_gateWindow` is only the no-parent fallback. */
  private _gateView: import('electron').BrowserView | null = null
  /** Main window to parent the gate on for the auto-present paths (sign-in +
   *  SSE). Registered via `setGateParent(mainWindow)`. When set, the blocking
   *  gate opens MODALLY over it — the OS blocks the app window while the gate is
   *  up, which (together with the non-dismissible close guard) is what makes the
   *  Terms gate a true block, matching Swift's `OneloAuthView` content cover.
   *  Unset → the gate still can't be dismissed, but floats non-modally so the
   *  user could alt-tab back to the app; that's why the snippet tells devs to
   *  register the window. */
  private _gateParent: import('electron').BrowserWindow | null = null
  /** Set true once the app is genuinely quitting (Cmd-Q / app.quit()) so the
   *  gate's no-dismiss close veto lets the quit through — the block must never
   *  trap the user with only force-quit left. Installed once (idempotent). */
  private _appQuitting = false
  private _quitHookInstalled = false
  /** Set synchronously at the top of presentGateIfNeeded and held across its
   *  `await requiredConsents()` round-trip, BEFORE `_gateWindow` is assigned —
   *  serializes concurrent callers (e.g. sign-in + a buffered SSE push on boot)
   *  so only one window opens. JS is single-threaded, so a boolean is enough. */
  private _presenting = false

  constructor(
    apiUrl: string,
    publishableKey: string,
    auth: OneloElectronAuth,
    bundleId?: string,
    autoPresent = true,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.auth = auth
    this.bundleId = bundleId
    this.autoPresent = autoPresent
  }

  // ── Observable revision (mirrors Swift @Published consentRevision) ──────────

  get consentRevision(): number {
    return this._consentRevision
  }

  /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   *  unsubscribe fn. Use when you build your own consent UI instead of the
   *  auto-presented gate. */
  onConsentRequired(listener: (revision: number) => void): () => void {
    this.revisionListeners.add(listener)
    return () => { this.revisionListeners.delete(listener) }
  }

  // ── Single-owner gate claim ─────────────────────────────────────────────────

  /** Claim the gate. Succeeds if free OR already yours (idempotent). Returns
   *  false if another presenter owns it → that caller must NOT show a gate. */
  claimConsentGate(id: string): boolean {
    if (this._gateOwner === null || this._gateOwner === id) {
      this._gateOwner = id
      return true
    }
    return false
  }

  /** Release the gate — only if `id` currently owns it (never steals). Safe to
   *  call unconditionally on teardown. */
  releaseConsentGate(id: string): void {
    if (this._gateOwner === id) this._gateOwner = null
  }

  /**
   * Register the app's main window so the AUTO-presented consent gate (sign-in +
   * `legal.consent_required` SSE) opens modally over it. Required for a true
   * hard block — without a parent the gate can't be dismissed but still floats
   * non-modally, so the user could keep using the app underneath. Call once after
   * you create your main window; pass `null` to clear (e.g. on window close).
   */
  setGateParent(win: import('electron').BrowserWindow | null): void {
    this._gateParent = win
  }

  // ── Data API (mirrors Swift OneloAuth.requiredConsents / acceptConsent) ──────

  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws) — parity with Swift's `requiredConsents()`.
   */
  async requiredConsents(): Promise<OneloConsentRequirement[]> {
    const session = await this.auth.getSession()
    if (!session) return []
    try {
      const { status, json } = await httpGet(
        `${this.apiUrl}/v1/sdk/consent/required`,
        sdkHeaders(this.bundleId, {
          Authorization: `Bearer ${session.accessToken}`,
          'X-Publishable-Key': this.publishableKey,
        }),
      )
      if (status !== 200) return []
      const rows = (json as { required?: unknown }).required
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => _mapRequirement(r as Record<string, unknown>))
        .filter((r): r is OneloConsentRequirement => r !== null)
    } catch {
      // Fail-open — the gate surfaces real blocking updates, not network blips.
      return []
    }
  }

  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   * Mirrors Swift `acceptConsent(versionId:)`.
   */
  async acceptConsent(versionId: string): Promise<void> {
    const session = await this.auth.getSession()
    if (!session) throw OneloError.notAuthenticated()
    const { status } = await httpPost(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      // snake_case `document_version_id` — the backend ConsentActionIn model.
      { document_version_id: versionId },
      sdkHeaders(this.bundleId, {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Publishable-Key': this.publishableKey,
        'Content-Type': 'application/json',
      }),
    )
    if (status === 401) throw OneloError.notAuthenticated()
    if (status < 200 || status >= 300) throw OneloError.server(`Failed to record consent: HTTP ${status}`)
  }

  // ── SSE wiring ──────────────────────────────────────────────────────────────

  /**
   * Register the `legal.consent_required` listener on the shared stream. The
   * event is a signal only (payload ignored, like Swift) — on receipt we bump
   * the revision, notify observers, and auto-present the gate if one is warranted.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('legal.consent_required', () => {
      this._consentRevision++
      for (const listener of this.revisionListeners) {
        try { listener(this._consentRevision) } catch { /* a listener must never break the stream */ }
      }
      // Only auto-open the window when enabled; observers still fired above.
      if (this.autoPresent) void this.presentGateIfNeeded()
    })
  }

  // ── Gate presentation (mirrors Swift OneloAuthView.checkConsent + gate) ──────

  /**
   * Check for an outstanding BLOCKING consent and, if present, open the hosted
   * gate. Returns true if a gate was shown. No-op when: no session, no blocking
   * document, another presenter owns the gate, or a gate window is already open.
   *
   * @param parentWindow  Pass your main window to present modally (blocks the app
   *                       until resolved — the faithful "blocking" behaviour).
   */
  async presentGateIfNeeded(parentWindow?: import('electron').BrowserWindow): Promise<boolean> {
    // A gate is already up, or another call is mid-flight (its `requiredConsents`
    // round-trip hasn't opened the window yet) — don't stack a second window.
    // Both guards are checked+set synchronously before the first `await`, so two
    // concurrent callers (sign-in + a buffered SSE push on boot) can't both pass.
    if (this._presenting) return false
    if (this._gateWindow && !this._gateWindow.isDestroyed()) return false
    if (this._gateView) return false
    this._presenting = true
    try {
      const items = await this.requiredConsents()
      const blocker = items.find((i) => i.blocking)
      if (!blocker) {
        // Nothing blocking — relinquish any claim so another presenter can react.
        this.releaseConsentGate(this.gateToken)
        return false
      }
      // Another presenter owns the gate → stand down (it will block the app).
      if (!this.claimConsentGate(this.gateToken)) return false
      // Can't present a document with no gate URL (platform-scope) — fail-open,
      // same as Swift, which needs `consentUrl` to show the gate.
      if (!blocker.consentUrl) {
        this.releaseConsentGate(this.gateToken)
        return false
      }
      // Auto-present paths (sign-in + SSE) pass no window; fall back to the
      // registered main window so the gate opens MODALLY (the true block).
      // Guard a destroyed window (dev cleared it late) → undefined = non-modal.
      const rawParent = parentWindow ?? this._gateParent
      const parent = rawParent && !rawParent.isDestroyed() ? rawParent : undefined
      if (parent) {
        // Registered main window → attach a full-window BrowserView overlay: it
        // fits the app window, resizes with it, blocks input, and has no window
        // chrome (non-dismissible). The native equivalent of the web overlay.
        await this._presentConsentOverlay(blocker, parent)
      } else {
        // No main window registered → fall back to a standalone gate window
        // (dismissible; _presentConsentWindow warns the dev to call setGateParent).
        await this._presentConsentWindow(blocker, undefined)
      }
      return true
    } finally {
      // Cleared once the window is set up (or we bailed); from here the
      // `_gateWindow` guard covers the open-window window.
      this._presenting = false
    }
  }

  /**
   * Present the gate as a BrowserView overlay that FILLS the app window and
   * resizes with it — the native equivalent of the web full-screen overlay. It
   * sits on top of the app content (blocking input) with no window chrome, so it
   * is non-dismissible: the only exits are Accept / Sign out (via the sentinel
   * nav) or a fail-open teardown if the page can't load. Requires a parent
   * window (from setGateParent or an explicit arg).
   */
  private async _presentConsentOverlay(
    requirement: OneloConsentRequirement,
    parentWindow: import('electron').BrowserWindow,
  ): Promise<void> {
    const { BrowserView, shell } = await import('electron')
    const view = new BrowserView({
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    this._gateView = view

    // Fill the window's content area and keep it filled on resize.
    const fit = (): void => {
      if (parentWindow.isDestroyed()) return
      const [w, h] = parentWindow.getContentSize()
      view.setBounds({ x: 0, y: 0, width: w, height: h })
    }
    parentWindow.addBrowserView(view)
    fit()
    const onResize = (): void => fit()
    parentWindow.on('resize', onResize)

    const wc = view.webContents
    const cleanup = (): void => {
      if (wc.isDestroyed()) return
      wc.removeListener('will-navigate', handleNav)
      wc.removeListener('will-redirect', handleNav)
    }

    let torn = false
    // Detach + free the overlay. Nulls `_gateView` synchronously so the accept
    // re-check can present the NEXT stacked doc. Releases the single-owner claim
    // so a non-action teardown (fail-open) lets a later trigger re-present.
    const teardown = (): void => {
      if (torn) return
      torn = true
      if (this._gateView === view) this._gateView = null
      parentWindow.removeListener('resize', onResize)
      parentWindow.removeListener('closed', teardown)
      cleanup()
      this.releaseConsentGate(this.gateToken)
      try { if (!parentWindow.isDestroyed()) parentWindow.removeBrowserView(view) } catch { /* parent gone */ }
      // BrowserView has no close(); free its webContents.
      try {
        const vwc = view.webContents as unknown as { destroy?: () => void; isDestroyed?: () => boolean }
        if (!vwc.isDestroyed?.()) vwc.destroy?.()
      } catch { /* already gone */ }
    }
    // If the app window is closed/destroyed while the gate is up, tear down so
    // `_gateView` + the single-owner claim aren't stranded — otherwise the
    // `_gateView` guard would suppress the gate for the rest of the process.
    // teardown is idempotent (torn guard). Registered AFTER teardown is defined
    // to avoid a temporal-dead-zone reference.
    parentWindow.on('closed', teardown)

    const handleNav = (event: Electron.Event, url: string): void => {
      if (!url.startsWith(CONSENT_SENTINEL)) return
      event.preventDefault()
      let action: string | null = null
      try { action = new URL(url).searchParams.get('action') } catch { /* keep null */ }
      cleanup()
      // teardown is the closeGate: accept → record + re-check (next stacked doc,
      // same overlay path); decline → sign out. Both run through _handleConsentAction.
      void this._handleConsentAction(action, requirement, teardown, parentWindow)
    }
    wc.on('will-navigate', handleNav)
    wc.on('will-redirect', handleNav)

    // Full policy links (privacy, etc.) open in the system browser.
    wc.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    // Fail-open: a load failure must not trap the user behind a blank overlay.
    wc.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) teardown()
    })

    try {
      await wc.loadURL(requirement.consentUrl as string)
      await wc.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT)
      // Pull keyboard focus into the overlay so the app content underneath can't
      // be keyboard-driven while the gate blocks it (addBrowserView only blocks
      // pointer input; focus decides where keys go).
      wc.focus()
    } catch {
      teardown()
    }
  }

  private async _presentConsentWindow(
    requirement: OneloConsentRequirement,
    parentWindow?: import('electron').BrowserWindow,
  ): Promise<void> {
    const { BrowserWindow, app } = await import('electron')
    // A modal gate (one WITH a parent) is what actually blocks the app; the
    // no-dismiss veto below only makes sense in that case.
    const modal = !!parentWindow
    // Register once: let a genuine app quit (Cmd-Q / app.quit()) pass through the
    // close veto so the gate can never trap the user with only force-quit left.
    if (!this._quitHookInstalled) {
      this._quitHookInstalled = true
      app.on('before-quit', () => { this._appQuitting = true })
    }
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      parent: parentWindow,
      modal,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      title: 'Review & Accept',
    })
    this._gateWindow = win

    // Hard block: while a MODAL gate is up for a blocking document the user must
    // NOT be able to escape by closing the window (parity with Swift's no-dismiss
    // cover). The only exits are Accept (→ record) or Decline (→ sign out), both
    // routed through the sentinel below. `allowClose` is flipped only by our own
    // teardown (`forceClose`), so action-driven and fail-open closes still work.
    let allowClose = false
    const forceClose = (): void => {
      allowClose = true
      // Null the handle synchronously so a re-check's guard doesn't see the
      // closing window and skip the next stacked document.
      if (this._gateWindow === win) this._gateWindow = null
      if (!win.isDestroyed()) win.close()
    }
    if (modal) {
      win.on('close', (e) => {
        // Let a genuine app quit through; only veto a user dismiss of the gate.
        if (this._appQuitting) return
        if (!allowClose && !win.isDestroyed()) { e.preventDefault(); win.focus() }
      })
    } else {
      // No parent → the gate can't block the app, so vetoing its close would only
      // trap a useless floating window (the worst outcome). Keep it dismissible
      // and tell the dev to register the main window for a real hard block.
      // eslint-disable-next-line no-console
      console.warn(
        '[Onelo] Consent gate is NOT hard-blocking: no main window registered. ' +
        'Call onelo.consent.setGateParent(mainWindow) so a blocking Terms/Privacy ' +
        'update modally blocks the app until the user accepts.',
      )
    }

    // True once Accept/Decline was routed (vs a fail-open close on load error,
    // where we release the claim so a later trigger re-presents).
    let actionHandled = false

    const cleanup = (): void => {
      // At the 'closed' event the webContents is ALREADY destroyed — touching it
      // throws "Object has been destroyed" (and its nav listeners die with it, so
      // there's nothing to remove). Guard so the 'closed' path is a no-op; the
      // cleanup() call from handleNav (window still alive) still runs normally.
      if (win.isDestroyed()) return
      win.webContents.removeListener('will-navigate', handleNav)
      win.webContents.removeListener('will-redirect', handleNav)
    }

    const handleNav = (event: Electron.Event, url: string): void => {
      if (!url.startsWith(CONSENT_SENTINEL)) return
      // This is our internal sentinel, not a real navigation — cancel it.
      event.preventDefault()
      let action: string | null = null
      try { action = new URL(url).searchParams.get('action') } catch { /* keep null */ }
      cleanup()
      actionHandled = true
      void this._handleConsentAction(action, requirement, forceClose, parentWindow)
    }

    win.webContents.on('will-navigate', handleNav)
    win.webContents.on('will-redirect', handleNav)

    // Full policy links (privacy, etc.) open in the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      void import('electron').then(({ shell }) => shell.openExternal(url))
      return { action: 'deny' }
    })

    win.on('closed', () => {
      cleanup()
      if (this._gateWindow === win) this._gateWindow = null
      // Manual dismiss (not via accept/decline): release the claim, leave the
      // session as-is. The next trigger (SSE, next launch) re-presents.
      if (!actionHandled) this.releaseConsentGate(this.gateToken)
    })

    win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      // Fail-open: a load failure must not trap the user behind a blank,
      // non-closable gate. forceClose bypasses the no-dismiss guard; the
      // 'closed' handler then releases the claim (actionHandled stays false) so
      // the next trigger re-checks. Consistent with the module's fail-open stance.
      if (isMainFrame) forceClose()
    })

    try {
      // consentUrl is guaranteed non-null by the caller.
      await win.loadURL(requirement.consentUrl as string)
      await win.webContents.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT)
    } catch {
      forceClose()
    }
  }

  /**
   * Apply the hosted page's accept/decline signal. Accept → record consent, then
   * RE-CHECK (documents stack — there may be another blocking doc). Decline (or
   * any non-accept) → sign out. Mirrors Swift `handleConsent`.
   */
  private async _handleConsentAction(
    action: string | null,
    requirement: OneloConsentRequirement,
    /** Bypasses the no-dismiss guard, nulls `_gateWindow` synchronously, and
     *  closes the window. See `forceClose` in `_presentConsentWindow`. */
    closeGate: () => void,
    parentWindow?: import('electron').BrowserWindow,
  ): Promise<void> {
    if (action === 'accept') {
      // Swallow accept errors (like Swift's `try?`) so a transient failure keeps
      // the user able to retry rather than bouncing them out.
      try { await this.acceptConsent(requirement.versionId) } catch { /* allow retry */ }
      this.releaseConsentGate(this.gateToken)
      // closeGate nulls `_gateWindow` SYNCHRONOUSLY before the re-check so the
      // re-check's guard doesn't see the closing window and skip the NEXT
      // stacked blocking document (they stack — e.g. Terms AND Privacy both due).
      closeGate()
      // Re-check for the NEXT blocking document, preserving the modal parent.
      await this.presentGateIfNeeded(parentWindow)
    } else {
      // Decline → sign out (no server decline endpoint; parity with Swift).
      this.releaseConsentGate(this.gateToken)
      closeGate()
      await this.auth.signOut().catch(() => { /* best-effort — session may be partly cleared */ })
    }
  }
}
