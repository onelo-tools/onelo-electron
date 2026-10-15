import { httpGet } from '@onelo/core'
import { OneloError } from './types'
import { sdkHeaders } from './sdk-headers'
import type { OneloElectronAuth } from './auth'
import { classifyHandBack } from './hand-back'
import { portalSkeletonHtml } from './brand-chrome'
import type { PlanChange } from './plan-change'

// Pre-connect loading skeleton (brand-chrome.ts `portalSkeletonHtml`), shown in
// the portal window until the hosted page paints. Loaded as a data: URL first,
// then swapped to the hosted URL — the WebContents keeps painting the skeleton
// until the real page commits. #681: painted from the brand tokens (portal-
// initiate `brand_tokens`, else config, else neutral).

/**
 * Injected into every page the portal window loads (#613 / #614). The hosted
 * portal (and the store it opens) asks for a fresh portal token with a
 * `onelo:renew_request` postMessage to its own window; this relay turns it into
 * a `<scheme>://renew-portal?request_id=…` navigation the window intercepts —
 * the same sentinel pattern Swift uses, because a BrowserWindow without a
 * preload has no other page→main channel. A request the page made before this
 * script ran is parked on `window.__oneloRenewPending` and forwarded here.
 */
export function portalRenewRelayScript(protocol: string): string {
  return `(function(){
  if (window.__oneloRenewRelay) return; window.__oneloRenewRelay = true;
  function fwd(d){
    if (!d || d.type !== 'onelo:renew_request' || d.kind !== 'portal' || typeof d.request_id !== 'string') return;
    window.location.href = ${JSON.stringify(`${protocol}://renew-portal?request_id=`)} + encodeURIComponent(d.request_id);
  }
  window.addEventListener('message', function(e){
    if (e.source !== window) return;
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d) } catch (_) { return } }
    fwd(d);
  });
  if (window.__oneloRenewPending) fwd(window.__oneloRenewPending);
})();`
}

/** True when both URLs parse and share scheme, host and port. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a); const ub = new URL(b)
    return ua.origin !== 'null' && ua.origin === ub.origin
  } catch {
    return false
  }
}

/** The script that delivers a renew reply into the page, as a self-post. */
export function portalRenewReplyScript(reply: Record<string, unknown>): string {
  return `window.postMessage(${JSON.stringify(reply)}, '*');`
}

export type PortalNavigation =
  | { kind: 'renew_portal'; requestId: string }
  | { kind: 'portal_done'; event: string | null }
  | { kind: 'checkout_complete' }
  | { kind: 'store_done'; reason: string }
  /** `<scheme>://callback?error=…` — the store link opened in this window is
   *  spent ("Return to app" on the expired screen). Close; nothing to exchange. */
  | { kind: 'store_cancel'; error: string }

/**
 * Which of the SDK's own deep-links a portal-window navigation is, or `null`
 * for everything else (hosted pages load normally). Pure, so the rule is
 * testable without a BrowserWindow.
 *
 * `protocol` is compared case-insensitively on the scheme prefix only.
 */
export function classifyPortalNavigation(url: string, protocol: string): PortalNavigation | null {
  const prefix = `${protocol}://`
  if (url.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.host === 'renew-portal') {
    const requestId = parsed.searchParams.get('request_id')
    return requestId ? { kind: 'renew_portal', requestId } : null
  }
  // Everything else is the one Store Hand-back decoder (#615): the portal's
  // Done, a purchase started from the portal (#592) or a plan switch with no
  // checkout (#599).
  const hb = classifyHandBack(url, protocol)
  if (!hb) return null
  switch (hb.kind) {
    case 'portal_closed': return { kind: 'portal_done', event: hb.event }
    case 'purchase': return { kind: 'checkout_complete' }
    case 'switched': return { kind: 'store_done', reason: hb.reason }
    case 'error': return { kind: 'store_cancel', error: hb.error }
  }
}

/** Where a portal opens. `'change_plan'` lands straight in the plan picker —
 *  the hosted portal asks the backend where the upgrade goes (#587). */
export type PortalIntent = 'change_plan'

/**
 * The hosted portal URL with `intent` as a query param (#606) — the same
 * param `@onelo/js` `customerPortal.open({ intent })` sets. No intent → the URL
 * unchanged.
 */
export function withPortalIntent(hostedUrl: string, intent?: PortalIntent): string {
  if (!intent) return hostedUrl
  try {
    const u = new URL(hostedUrl)
    u.searchParams.set('intent', intent)
    return u.toString()
  } catch {
    return hostedUrl
  }
}

/**
 * Opens the Onelo hosted customer portal in a standalone BrowserWindow.
 *
 * The portal lets signed-in users manage their subscription, billing, and
 * account settings. It mirrors Swift's `OneloCustomerPortalView` /
 * `openCustomerPortal()` and uses the same BrowserWindow + deep-link
 * interception pattern as `OneloElectronAuth#presentAuthWindow`.
 *
 * Usage:
 *   await onelo.customerPortal.open()
 *   // or with a parent window for modal centering:
 *   await onelo.customerPortal.open(mainWindow)
 */
export class OneloElectronCustomerPortal {
  /** Told when the store opened in the portal window ended in a purchase or a
   *  plan switch (#659). Set by `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }

  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly auth: OneloElectronAuth
  private readonly protocol: string
  private readonly bundleId?: string

  constructor(
    apiUrl: string,
    publishableKey: string,
    auth: OneloElectronAuth,
    /** Deep-link scheme (same one used for auth callbacks, e.g. "myapp") */
    protocol: string,
    /** App bundle id — sent as X-Bundle-Id. The backend's
     *  validate_sdk_request_security REQUIRES it on live keys, so omitting it
     *  (as this module used to) makes portal-initiate 403 on production. Every
     *  sibling module (store/forms/waitlist/features) already threads it. */
    bundleId?: string,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.auth = auth
    this.bundleId = bundleId
    // The backend lowercases the callback scheme before storing, so the
    // portal's final redirect is always lowercase. Normalize once here and
    // use the same value for both the portal-initiate query param and the
    // deep-link interception — otherwise an uppercase scheme (e.g. 'MyApp')
    // passes initiate but interception never fires.
    this.protocol = protocol.toLowerCase()
  }

  /**
   * Mint a portal token and return the hosted portal URL. Requires an active
   * session — the token travels in the `Authorization: Bearer` header, NEVER in
   * the URL, so it can't leak into logs / history / crash reports. Mirrors Swift
   * `initiateCustomerPortal()`. Use for a custom presentation; `open()` /
   * `openInBrowser()` wrap it.
   */
  async initiate(): Promise<string> {
    const session = await this.auth.getSession()
    if (!session) throw OneloError.notAuthenticated()

    const initiateUrl =
      `${this.apiUrl}/api/sdk/paywall/portal-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&callback_scheme=${encodeURIComponent(this.protocol)}`

    const { status, json } = await httpGet(
      initiateUrl,
      sdkHeaders(this.bundleId, { Authorization: `Bearer ${session.accessToken}` }),
    )
    if (status === 401) throw OneloError.notAuthenticated()
    if (status !== 200) throw OneloError.server(`Failed to initiate customer portal: HTTP ${status}`)

    const j = json as Record<string, unknown>
    this.auth.brand.adopt(j)
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response: missing hosted_url')
    return hostedUrl
  }

  /**
   * Answer the hosted portal's `onelo:renew_request` (#613 / #614): mint a fresh
   * portal with the signed-in user's own session. Signed out or refused →
   * `renew_failed` with `not_authenticated`, and the page shows its branded
   * "signed out" screen. Never throws.
   */
  async renewReply(requestId: string): Promise<Record<string, unknown>> {
    try {
      const hostedUrl = await this.initiate()
      return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch (e) {
      const reason = e instanceof OneloError && e.code === 'not_authenticated' ? 'not_authenticated' : 'renew_failed'
      return { type: 'onelo:renew_failed', request_id: requestId, reason }
    }
  }

  /**
   * Open the Onelo hosted customer portal in a standalone in-app BrowserWindow.
   * Throws `OneloError` (`not_authenticated`) when no session is active.
   *
   * @param parentWindow  Optional parent BrowserWindow (for modal centering).
   * @param opts.intent   `'change_plan'` opens the portal straight into the plan
   *   picker (parity with `@onelo/js` `customerPortal.open({ intent })`). The
   *   hosted portal asks the backend where the change goes — a plan switch, the
   *   store for a user without a paid plan, or an explanation when plan changes
   *   are off.
   * @returns             Resolves when the portal window is closed.
   */
  async open(parentWindow?: import('electron').BrowserWindow, opts?: { intent?: PortalIntent }): Promise<void> {
    const hostedUrl = await this.initiate()
    return this.presentUrl(withPortalIntent(hostedUrl, opts?.intent), parentWindow)
  }

  /**
   * Present an already-minted hosted URL (portal, or a store / plan-switch URL
   * from `/upgrade-initiate`) in the portal window. Handles every hand-back the
   * portal does, then re-reads the entitlement so `hasActiveAccess` reflects a
   * plan bought or changed in the window. Resolves when the window closes.
   * @internal Used by `OneloStore.openUpgrade`.
   */
  async presentUrl(url: string, parentWindow?: import('electron').BrowserWindow): Promise<void> {
    await this._presentPortalWindow(url, parentWindow)
    await this.auth.revalidateEntitlement().catch(() => { /* best-effort */ })
  }

  /**
   * Open the customer portal in the user's DEFAULT SYSTEM BROWSER (via
   * `shell.openExternal`) instead of an in-app window. Preferred for the payment
   * surface — the buyer sees the real domain + has their saved cards / password
   * manager, and the app can't inspect the page. Mirrors Swift
   * `openCustomerPortalInBrowser()`.
   *
   * The portal signals account-lifecycle events (e.g. deletion) back via the
   * app's deep-link scheme. Wire your `app.on('open-url')` (macOS) /
   * `second-instance` (win/linux) handler to call `handlePortalCallback(url)` so
   * those events clear the local session.
   */
  async openInBrowser(opts?: { intent?: PortalIntent }): Promise<void> {
    const hostedUrl = await this.initiate()
    const { shell } = await import('electron')
    await shell.openExternal(withPortalIntent(hostedUrl, opts?.intent))
  }

  /**
   * Process a portal deep-link the OS handed to your app — only needed for the
   * `openInBrowser()` path (the embedded `open()` intercepts it itself). On a
   * hard account event (deletion / revoke / compromise) it clears the local
   * session. Returns true if the URL was a portal callback. Never throws.
   */
  async handlePortalCallback(url: string): Promise<boolean> {
    let parsed: URL
    try { parsed = new URL(url) } catch { return false }
    if (parsed.searchParams.get('source') !== 'portal') return false
    await this._applyPortalEvent(parsed.searchParams.get('event'))
    return true
  }

  /** Hard account-lifecycle events the portal can deep-link back — each clears
   *  the local session instantly (mirrors Swift's set). */
  private static readonly REVOKE_EVENTS = new Set([
    'account_deletion_scheduled', 'account_revoked', 'session_compromised',
  ])

  /** Clear the local session on a hard portal event: flag isUserRevoked + sign
   *  out. No-op for other/absent events. Never throws. */
  private async _applyPortalEvent(event: string | null): Promise<void> {
    if (!event || !OneloElectronCustomerPortal.REVOKE_EVENTS.has(event)) return
    this.auth.isUserRevoked = true
    await this.auth.signOut().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[Onelo] signOut after portal event failed (session may not be fully cleared):', err)
    })
  }

  private _presentPortalWindow(
    hostedUrl: string,
    parentWindow?: import('electron').BrowserWindow,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      import('electron')
        .then(({ BrowserWindow }) => {
          const win = new BrowserWindow({
            // Tall enough for the full hosted portal (plan, receipts, cancel /
            // resume, manage) + an enforced floor so nothing clips. Same sizing
            // as the auth + feedback windows (720 / min 440×680; resizable makes
            // the min bind).
            // Wide, like the store: the portal's content column is a fixed
            // 432px that does not grow, so in a 480px window it touches both
            // edges and reads as enormous even though every size is exactly as
            // configured (measured 2026-08-19). Given room, it looks like the
            // same page does in a browser. Kept in step with
            // `hostedWindowSize()` in auth.ts, which sizes the store window.
            width: 780,
            height: 720,
            minWidth: 560,
            minHeight: 680,
            parent: parentWindow,
            modal: !!parentWindow,
            resizable: true,
            minimizable: false,
            maximizable: false,
            // Brand page_bg so the window never flashes white before the skeleton /
            // hosted page paints (#681; matches the skeleton + hosted portal).
            backgroundColor: this.auth.brand.current().page_bg,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
            title: 'Manage Account',
          })

          win.setMenuBarVisibility(false)
          // Paint the baked skeleton instantly (data: URL, no network), THEN swap
          // to the hosted portal — the WebContents keeps showing the skeleton until
          // the real page commits, so there's no blank/white flash during the load.
          // will-navigate does not fire for programmatic loadURL, and handleNav only
          // acts on `${protocol}://` URLs, so the data: load can't trip the deep-link
          // interceptor. A failure in either load closes the window → 'closed' resolves.
          win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(portalSkeletonHtml(this.auth.brand.current()))}`)
            .then(() => { if (!win.isDestroyed()) return win.loadURL(hostedUrl) })
            .catch(() => {
              // loadURL threw (e.g. invalid URL scheme). The did-fail-load handler
              // covers async navigation failures; this catch covers the synchronous
              // throw path so we never get an unhandled rejection. Closing the window
              // triggers 'closed' → resolve(), which is the single settle point.
              if (!win.isDestroyed()) win.close()
            })

          // If the main-frame load fails (offline / DNS / TLS / 5xx), close
          // the window so the 'closed' handler below can resolve the promise.
          // Without this the window stays invisible and open() hangs forever.
          win.webContents.on('did-fail-load', (_e, _errorCode, _errorDesc, _validatedURL, isMainFrame) => {
            if (isMainFrame && !win.isDestroyed()) win.close()
          })

          // External links (e.g. receipts, policy pages) open in system browser
          win.webContents.setWindowOpenHandler(({ url }) => {
            import('electron').then(({ shell }) => shell.openExternal(url))
            return { action: 'deny' }
          })

          // When the deletion event is received, signOut() must settle before
          // open() resolves — otherwise the caller could re-render while the
          // local session is still being cleared.
          let pendingSignOut: Promise<void> | null = null

          // Intercept the portal's deep-links (see classifyPortalNavigation):
          //   <scheme>://callback?source=portal[&event=…] — portal Done / hard event
          //   <scheme>://callback?code=…                   — a store purchase started
          //     from the portal finished (#592). The window just closes: the buyer
          //     is already signed in, and the plan is reconciled at once (#659).
          //     Blocked so the scheme URL never reaches the OS (second instance).
          const handleNav = (event: Electron.Event, url: string): void => {
            const nav = classifyPortalNavigation(url, this.protocol)
            if (!nav) return

            // #614 — the page asks for a fresh portal token. Not a close: block
            // the sentinel, answer into the page, keep listening.
            if (nav.kind === 'renew_portal') {
              event.preventDefault()
              // A fresh portal is a bearer credential: answer only a page still
              // on the portal's own origin, never one the window navigated to.
              if (!sameOrigin(win.webContents.getURL(), hostedUrl)) return
              void this.renewReply(nav.requestId).then((reply) => {
                if (!win.isDestroyed()) {
                  win.webContents.executeJavaScript(portalRenewReplyScript(reply)).catch(() => { /* page gone */ })
                }
              })
              return
            }

            win.webContents.removeListener('will-redirect', handleNav)
            win.webContents.removeListener('will-navigate', handleNav)

            const closeAndResolve = (): void => {
              if (!win.isDestroyed()) win.close()
            }

            //   <scheme>://callback?source=store&event=… — a plan switch with no
            //     checkout finished (#599). Same close: nothing to exchange.
            //   <scheme>://callback?error=… — the store link is spent and the
            //     buyer tapped "Return to app". Same close.
            if (nav.kind === 'checkout_complete' || nav.kind === 'store_done' || nav.kind === 'store_cancel') {
              event.preventDefault()
              // A purchase or a switch moved the plan: reconcile now (#659),
              // not whenever the stream catches up.
              if (nav.kind === 'checkout_complete') this.onPlanChange?.({ kind: 'purchase' })
              else if (nav.kind === 'store_done') this.onPlanChange?.({ kind: 'switched', reason: nav.reason })
              closeAndResolve()
              return
            }
            // Hard events (deletion / revoke / compromise) clear the local
            // session before closing; other/absent events just close. Track the
            // promise so the 'closed' handler awaits it (the user could close the
            // window manually before signOut settles). _applyPortalEvent is a
            // no-op for non-revoke events → resolves immediately.
            pendingSignOut = this._applyPortalEvent(nav.event)
            pendingSignOut.finally(closeAndResolve)
          }

          win.webContents.on('will-redirect', handleNav)
          win.webContents.on('will-navigate', handleNav)
          // Every page the window loads (portal, then the store it opens) gets
          // the renew relay (#614).
          const installRenewRelay = (): void => {
            if (win.isDestroyed()) return
            win.webContents.executeJavaScript(portalRenewRelayScript(this.protocol)).catch(() => { /* data: skeleton or page gone */ })
          }
          win.webContents.on('dom-ready', installRenewRelay)

          win.on('closed', () => {
            // At 'closed' the webContents is already destroyed — its nav
            // listeners are gone and touching it throws "Object has been
            // destroyed". Guard the access (they're auto-removed with the
            // webContents; handleNav already removes them on the happy path).
            if (!win.isDestroyed()) {
              win.webContents.removeListener('will-redirect', handleNav)
              win.webContents.removeListener('will-navigate', handleNav)
            }
            // If a deletion sign-out is in flight, resolve only after it
            // settles. pendingSignOut already has a .catch that logs, so it
            // never rejects — .then(resolve) is safe.
            if (pendingSignOut) {
              pendingSignOut.then(resolve)
            } else {
              resolve()
            }
          })
        })
        .catch(reject)
    })
  }
}
