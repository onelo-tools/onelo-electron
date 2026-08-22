import { httpGet } from '@onelo/core'
import { OneloError } from './types'
import { sdkHeaders } from './sdk-headers'
import type { OneloElectronAuth } from './auth'

// Pre-connect loading skeleton, shown in the portal window until the hosted page
// paints (previously a blank white window flashed during the load). Loaded as a
// data: URL first, then swapped to the hosted URL — the WebContents keeps painting
// the skeleton until the real page commits. Layout mirrors the hosted PortalSkeleton
// (frontend/app/customer/portal/PortalSkeleton.tsx) 1:1 — the same shape used by
// every SDK — so the cross-fade has zero layout shift. No branding bg is plumbed to
// the portal window, so #111111 (matching the window backgroundColor) is used.
const SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px;border-radius:4px}
.c1{height:240px;border-radius:14px}
.c2{height:80px;border-radius:14px}
.c3{height:140px;border-radius:14px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`

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
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response: missing hosted_url')
    return hostedUrl
  }

  /**
   * Open the Onelo hosted customer portal in a standalone in-app BrowserWindow.
   * Throws `OneloError` (`not_authenticated`) when no session is active.
   *
   * @param parentWindow  Optional parent BrowserWindow (for modal centering).
   * @returns             Resolves when the portal window is closed.
   */
  async open(parentWindow?: import('electron').BrowserWindow): Promise<void> {
    const hostedUrl = await this.initiate()
    return this._presentPortalWindow(hostedUrl, parentWindow)
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
  async openInBrowser(): Promise<void> {
    const hostedUrl = await this.initiate()
    const { shell } = await import('electron')
    await shell.openExternal(hostedUrl)
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
            // Dark ground so the window never flashes white before the skeleton /
            // hosted page paints (matches the skeleton + hosted portal background).
            backgroundColor: '#111111',
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
          win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SKELETON_HTML)}`)
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

          // Intercept the portal-done deep-link: <scheme>://callback?source=portal
          // Optionally carries &event=account_deletion_scheduled.
          const handleNav = (_event: Electron.Event, url: string): void => {
            // Compare only the scheme prefix case-insensitively; keep the
            // original url intact for URL parsing below.
            const prefix = `${this.protocol}://`
            if (url.slice(0, prefix.length).toLowerCase() !== prefix) return

            let parsed: URL
            try {
              parsed = new URL(url)
            } catch {
              return
            }

            if (parsed.searchParams.get('source') !== 'portal') return

            win.webContents.removeListener('will-redirect', handleNav)
            win.webContents.removeListener('will-navigate', handleNav)

            const closeAndResolve = (): void => {
              if (!win.isDestroyed()) win.close()
            }
            // Hard events (deletion / revoke / compromise) clear the local
            // session before closing; other/absent events just close. Track the
            // promise so the 'closed' handler awaits it (the user could close the
            // window manually before signOut settles). _applyPortalEvent is a
            // no-op for non-revoke events → resolves immediately.
            pendingSignOut = this._applyPortalEvent(parsed.searchParams.get('event'))
            pendingSignOut.finally(closeAndResolve)
          }

          win.webContents.on('will-redirect', handleNav)
          win.webContents.on('will-navigate', handleNav)

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
