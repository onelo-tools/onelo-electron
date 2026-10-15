import https from 'https'
import http from 'http'
import type { OneloFeatures } from './features'
import { sdkHeaders } from './sdk-headers'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from './user-token'
import { BrandSource } from '@onelo/core'
import { brandErrorPageHtml, feedbackSkeletonHtml } from './brand-chrome'

interface FeedbackConfig {
  publishableKey: string
  apiUrl: string
  bundleId?: string
}

interface OpenOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) })
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null })
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

export const FEEDBACK_SUBMITTED_SENTINEL = 'onelo://feedback_submitted'
// The hosted page renders the close "✕" now (frontend HostedCloseX) and emits
// `onelo:feedback_close` when tapped — twin of `onelo:feedback_submitted`. Its
// sentinel is intercepted by the same will-navigate handler → close the window
// (parity with the hosted-rendered ✕ on every SDK; spec 2026-07-27).
export const FEEDBACK_CLOSE_SENTINEL = 'onelo://feedback_close'
// The error screen's "Try again" button navigates here; the persistent
// will-navigate interceptor catches it and re-runs the fetch in the same window
// (parity with Swift's onelo://feedback_retry sentinel + FeedbackWebCoordinator).
const FEEDBACK_RETRY_SENTINEL = 'onelo://feedback_retry'
// #622 — the hosted form's reporter token `ft` expired and it asks for a fresh
// one (`onelo:renew_request`, kind `feedback`, a self-post). The relay turns it
// into this sentinel; handleNav re-initiates and answers into the page.
export const FEEDBACK_RENEW_SENTINEL = 'onelo://feedback_renew'

export const POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  function renew(d) {
    if (!d || d.type !== 'onelo:renew_request' || d.kind !== 'feedback' || typeof d.request_id !== 'string') return;
    window.location.href = '${FEEDBACK_RENEW_SENTINEL}?request_id=' + encodeURIComponent(d.request_id);
  }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'onelo:feedback_submitted') {
      window.location.href = '${FEEDBACK_SUBMITTED_SENTINEL}';
    } else if (e.data && e.data.type === 'onelo:feedback_close') {
      window.location.href = '${FEEDBACK_CLOSE_SENTINEL}';
    } else if (e.source === window) {
      var d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch (_) { return } }
      renew(d);
    }
  });
  if (window.__oneloRenewPending) renew(window.__oneloRenewPending);
})();
`

/** The request id of a `onelo://feedback_renew?request_id=…` sentinel, or null. */
export function feedbackRenewRequestId(url: string): string | null {
  if (!url.startsWith(FEEDBACK_RENEW_SENTINEL)) return null
  try {
    const id = new URL(url).searchParams.get('request_id')
    return id ? id : null
  } catch {
    return null
  }
}

/** True when both URLs parse and share scheme, host and port. */
function sameOrigin(a: string, b: string | null): boolean {
  if (!b) return false
  try {
    const ua = new URL(a); const ub = new URL(b)
    return ua.origin !== 'null' && ua.origin === ub.origin
  } catch {
    return false
  }
}


export class OneloFeedback {
  /** The SDK's brand-token model (#681). `Onelo` shares the auth's one. */
  private brand: BrandSource = new BrandSource()
  setBrandSource(brand: BrandSource): void {
    this.brand = brand
  }
  private readonly config: FeedbackConfig
  private readonly features: OneloFeatures
  private window: import('electron').BrowserWindow | null = null
  /** The hosted form URL the window was last sent to (for the renew origin check). */
  private hostedUrl: string | null = null

  /** The signed-in Onelo user's access token (#820). Wired by `Onelo` to
   *  `auth`; with a session the initiate call carries it and the report names
   *  a verified reporter. Absent, the call is exactly as before. */
  private readonly userToken?: UserTokenSource

  constructor(config: FeedbackConfig, features: OneloFeatures, userToken?: UserTokenSource) {
    this.config = config
    this.features = features
    this.userToken = userToken
  }

  /** No-op shim — session context is now derived from active feature flags automatically. */
  track(_area: string): void {}

  buildInitiateUrl(options?: OpenOptions): string {
    const params = new URLSearchParams({ key: this.config.publishableKey })
    if (options?.type) params.set('type', options.type)
    if (options?.area) params.set('area', options.area)
    const active = this.features.getActiveFeatures()
    if (active.length > 0) {
      params.set('session', JSON.stringify(active))
    }
    return `${this.config.apiUrl}/api/sdk/feedback/initiate?${params.toString()}`
  }

  open(options?: OpenOptions): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      return
    }

    void this._openAsync(options)
  }

  private async _openAsync(options?: OpenOptions): Promise<void> {
    const { BrowserWindow } = await import('electron')

    // 1. Show window immediately with skeleton — same pattern as Swift openAsWindow()
    this.window = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 480,
      minHeight: 680,
      resizable: true,
      title: 'Send Feedback',
      backgroundColor: this.brand.current().page_bg,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    this.window.show()

    // Route target="_blank" / external links (policy pages inside the hosted
    // feedback form) to the system browser — same as the auth/portal/consent
    // windows. Per-webContents, so it survives the skeleton→hosted loadURL.
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      void import('electron').then(({ shell }) => shell.openExternal(url))
      return { action: 'deny' }
    })
    this.window.on('closed', () => { this.window = null })

    // ONE persistent in-page navigation interceptor for BOTH sentinels — mirrors
    // Swift's FeedbackWebCoordinator (attached once, survives every
    // skeleton→hosted→error→retry reload). Programmatic `loadURL()` never fires
    // will-navigate, so only the page's own `window.location='onelo://…'` reaches
    // here:
    //   • feedback_submitted → close the window (the form posted successfully)
    //   • feedback_close     → close the window (hosted-rendered ✕ was tapped)
    //   • feedback_retry     → re-run the fetch in the SAME window (Swift onRetry)
    const handleNav = (event: Electron.Event, url: string) => {
      if (url.startsWith(FEEDBACK_SUBMITTED_SENTINEL) || url.startsWith(FEEDBACK_CLOSE_SENTINEL)) {
        event.preventDefault()
        this.window?.close()
        this.window = null
      } else if (url.startsWith(FEEDBACK_RETRY_SENTINEL)) {
        event.preventDefault()
        void this._loadHostedForm(options)
      } else if (url.startsWith(FEEDBACK_RENEW_SENTINEL)) {
        // #622 — not a close: block the sentinel, answer into the page.
        event.preventDefault()
        const requestId = feedbackRenewRequestId(url)
        const win = this.window
        if (!requestId || !win || win.isDestroyed()) return
        // Answer only a page still on the hosted form's own origin.
        if (!sameOrigin(win.webContents.getURL(), this.hostedUrl)) return
        void this.renewReply(requestId, options).then((reply) => {
          if (!win.isDestroyed()) {
            win.webContents.executeJavaScript(`window.postMessage(${JSON.stringify(reply)}, '*');`).catch(() => { /* page gone */ })
          }
        })
      }
    }
    this.window.webContents.on('will-navigate', handleNav)
    this.window.webContents.on('will-redirect', handleNav)

    // 2. Load the skeleton + fetch the hosted form. Retry re-invokes this.
    await this._loadHostedForm(options)
  }

  /** Show the skeleton, resolve the hosted URL, and navigate the WebView. On
   *  failure renders an in-window error screen WITH a Retry button (never a
   *  silent close). Retry (the button's onelo://feedback_retry nav → handleNav)
   *  re-invokes this exact method — 1:1 with Swift's loadHostedForm/onRetry. */
  private async _loadHostedForm(options?: OpenOptions): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return
    try {
      // Skeleton (shimmer) immediately while the network resolves. Kept INSIDE
      // the try so a window teardown mid-load can't reject this method — it's
      // invoked as `void this._loadHostedForm(...)` from the retry interceptor,
      // so an escaping rejection would be unhandled.
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(feedbackSkeletonHtml(this.brand.current()))}`)
      if (!this.window || this.window.isDestroyed()) return
      const result = await this._initiate(options)
      if (!result.ok) {
        // Show the error in-window instead of silently closing (no-silent-
        // swallows — mirrors Swift's errorHTML). The user sees what happened.
        await this._showError(`Couldn't load feedback (HTTP ${result.status}).`)
        return
      }
      const hosted_url = result.hostedUrl

      if (!this.window || this.window.isDestroyed()) return
      this.hostedUrl = hosted_url
      await this.window.loadURL(hosted_url)
      // Relay the hosted page's postMessage → the submitted sentinel that
      // handleNav (installed once in _openAsync) intercepts. Re-injected on every
      // (re)load of the hosted form.
      await this.window.webContents.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT)
    } catch {
      await this._showError("Couldn't reach the feedback service. Check your connection and try again.")
    }
  }

  /** Mint a hosted feedback URL (and with it a fresh reporter token `ft`). */
  private async _initiate(options?: OpenOptions): Promise<{ ok: true; hostedUrl: string } | { ok: false; status: number }> {
    const initiateUrl = this.buildInitiateUrl(options)
    // Signed in (#820): `Authorization: Bearer <access token>` makes the server
    // sign the token's user as a VERIFIED reporter. A refused token is refreshed
    // and retried once; refused again, the form still opens without it (as a
    // signed-out call would), so feedback never fails on identity.
    // userId as a header (X-Onelo-User-Id), not a query param → stays out of logs.
    // Without a session it is the developer's unverified label.
    const { status, json } = await sendWithUserToken(this.userToken, ({ token }) => httpGet(initiateUrl, {
      ...sdkHeaders(this.config.bundleId),
      ...bearerHeader(token),
      ...(options?.userId ? { 'X-Onelo-User-Id': options.userId } : {}),
    }), () => {})
    const hostedUrl = (json as { hosted_url?: unknown } | null)?.hosted_url
    if (status < 200 || status >= 300 || typeof hostedUrl !== 'string' || !hostedUrl) return { ok: false, status }
    return { ok: true, hostedUrl }
  }

  /**
   * Answer the hosted form's `onelo:renew_request` (kind `feedback`, #622). The
   * form's reporter token `ft` lives 30 minutes; a form left open longer asks
   * for a fresh one on submit. The same options are initiated again, so the
   * report keeps its reporter, type, area and session.
   */
  async renewReply(requestId: string, options?: OpenOptions): Promise<Record<string, unknown>> {
    try {
      const result = await this._initiate(options)
      if (result.ok) return { type: 'onelo:renewed', request_id: requestId, hosted_url: result.hostedUrl }
    } catch { /* network: fall through */ }
    return { type: 'onelo:renew_failed', request_id: requestId, reason: 'renew_failed' }
  }

  /** Render an error screen WITH a "Try again" button inside the feedback window
   *  instead of silently closing (no-silent-swallows). The button navigates to
   *  the onelo://feedback_retry sentinel, which handleNav (installed once in
   *  _openAsync) intercepts → re-runs _loadHostedForm in the SAME window. This is
   *  the 1:1 parity with Swift's errorHTML + onRetry (JS just throws — no retry). */
  private async _showError(message: string): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return
    // Copy mirrors Swift OneloFeedback.errorHTML; colours, font and the "Try
    // again" button come from the brand tokens (#681). brandErrorPageHtml escapes.
    const html = brandErrorPageHtml(this.brand.current(), {
      title: "Couldn't load feedback",
      message,
      retryHref: FEEDBACK_RETRY_SENTINEL,
    })
    try { await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`) } catch { /* window gone */ }
  }
}
