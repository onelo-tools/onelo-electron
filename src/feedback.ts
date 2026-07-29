import https from 'https'
import http from 'http'
import type { OneloFeatures } from './features'
import { sdkHeaders } from './sdk-headers'

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

export const POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'onelo:feedback_submitted') {
      window.location.href = '${FEEDBACK_SUBMITTED_SENTINEL}';
    } else if (e.data && e.data.type === 'onelo:feedback_close') {
      window.location.href = '${FEEDBACK_CLOSE_SENTINEL}';
    }
  });
})();
`

const SKELETON_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #111;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 40px 36px 32px;
    overflow: hidden;
  }
  @keyframes shimmer {
    0%   { background-position: -600px 0; }
    100% { background-position:  600px 0; }
  }
  .sk {
    border-radius: 10px;
    background: linear-gradient(90deg, #1e1e1e 25%, #2a2a2a 50%, #1e1e1e 75%);
    background-size: 600px 100%;
    animation: shimmer 1.4s infinite linear;
  }
  .icon     { width: 64px; height: 64px; border-radius: 14px; margin: 0 auto 16px; }
  .title    { width: 220px; height: 22px; margin: 0 auto 40px; border-radius: 6px; }
  .cards    { display: flex; gap: 12px; margin-bottom: 32px; }
  .card     { flex: 1; height: 76px; border-radius: 12px; }
  .label    { width: 60px; height: 13px; border-radius: 4px; margin-bottom: 8px; }
  .input    { width: 100%; height: 44px; border-radius: 10px; margin-bottom: 24px; }
  .textarea { width: 100%; height: 110px; border-radius: 10px; margin-bottom: 32px; }
  .btn      { width: 100%; height: 48px; border-radius: 12px; }
</style>
</head>
<body>
  <div class="sk icon"></div>
  <div class="sk title"></div>
  <div class="cards">
    <div class="sk card"></div>
    <div class="sk card"></div>
    <div class="sk card"></div>
  </div>
  <div class="sk label"></div>
  <div class="sk input"></div>
  <div class="sk label"></div>
  <div class="sk textarea"></div>
  <div class="sk btn"></div>
</body>
</html>`

export class OneloFeedback {
  private readonly config: FeedbackConfig
  private readonly features: OneloFeatures
  private window: import('electron').BrowserWindow | null = null

  constructor(config: FeedbackConfig, features: OneloFeatures) {
    this.config = config
    this.features = features
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
      backgroundColor: '#111111',
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
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SKELETON_HTML)}`)
      if (!this.window || this.window.isDestroyed()) return
      const initiateUrl = this.buildInitiateUrl(options)
      // userId as a header (X-Onelo-User-Id), not a query param → stays out of logs.
      const headers = { ...sdkHeaders(this.config.bundleId), ...(options?.userId ? { 'X-Onelo-User-Id': options.userId } : {}) }
      const { status, json } = await httpGet(initiateUrl, headers)
      if (status < 200 || status >= 300) {
        // Show the error in-window instead of silently closing (no-silent-
        // swallows — mirrors Swift's errorHTML). The user sees what happened.
        await this._showError(`Couldn't load feedback (HTTP ${status}).`)
        return
      }
      const { hosted_url } = json as { hosted_url: string }

      if (!this.window || this.window.isDestroyed()) return
      await this.window.loadURL(hosted_url)
      // Relay the hosted page's postMessage → the submitted sentinel that
      // handleNav (installed once in _openAsync) intercepts. Re-injected on every
      // (re)load of the hosted form.
      await this.window.webContents.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT)
    } catch {
      await this._showError("Couldn't reach the feedback service. Check your connection and try again.")
    }
  }

  /** Render an error screen WITH a "Try again" button inside the feedback window
   *  instead of silently closing (no-silent-swallows). The button navigates to
   *  the onelo://feedback_retry sentinel, which handleNav (installed once in
   *  _openAsync) intercepts → re-runs _loadHostedForm in the SAME window. This is
   *  the 1:1 parity with Swift's errorHTML + onRetry (JS just throws — no retry). */
  private async _showError(message: string): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return
    const safe = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
    // Copy + styling mirror Swift OneloFeedback.errorHTML (title / message / white
    // "Try again" button on #111 dark).
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%}
      body{background:#111;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 36px}
      .title{font-size:17px;font-weight:600;margin-bottom:10px}
      .msg{font-size:13px;color:#9a9a9a;line-height:1.5;max-width:320px;margin-bottom:28px}
      .btn{appearance:none;border:0;cursor:pointer;background:#fff;color:#111;font-size:14px;font-weight:600;padding:11px 22px;border-radius:10px}
      .btn:active{opacity:.8}</style>
      <div class="title">Couldn't load feedback</div>
      <div class="msg">${safe}</div>
      <button class="btn" onclick="window.location.href='${FEEDBACK_RETRY_SENTINEL}'">Try again</button>`
    try { await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`) } catch { /* window gone */ }
  }
}
