/**
 * The Electron SDK's native chrome, built from the app's brand tokens (#681).
 *
 * Everything this SDK paints itself — the "Try again" error pages, the portal
 * and feedback skeletons shown before the hosted page commits — is a data: page
 * rendered from `BrandTokens` (the one model in `@onelo/core`, set from
 * `/api/sdk/config` and refreshed by initiate responses). No hard-coded
 * grounds: a light-branded app gets a light error page with its own button.
 */
import { portalSkeletonHtml, feedbackSkeletonHtml, type BrandTokens } from '@onelo/core'

/** HTML-escape a value placed in page text. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/**
 * An error screen with a "Try again" button. The button navigates `retryHref`
 * (an SDK sentinel URL the window's will-navigate handler intercepts).
 */
export function brandErrorPageHtml(
  t: BrandTokens,
  { title, message, retryHref, buttonLabel = 'Try again' }: { title: string; message: string; retryHref: string; buttonLabel?: string },
): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:${t.page_bg};font-family:${t.body_font};display:flex;align-items:center;justify-content:center;padding:32px;color:${t.text}}
.card{max-width:340px;text-align:center}
.title{font-size:17px;font-weight:600;margin-bottom:8px;font-family:${t.heading_font}}
.msg{font-size:13px;line-height:1.5;color:${t.text_muted};margin-bottom:24px}
button{font:inherit;font-size:14px;font-weight:600;padding:11px 24px;border-radius:${t.button_radius}px;border:none;background:${t.button_bg};color:${t.button_text};cursor:pointer}
button:hover{opacity:0.9}
button:focus-visible{outline:2px solid ${t.brand};outline-offset:2px}
</style></head><body>
<div class="card">
<div class="title">${esc(title)}</div>
<div class="msg">${esc(message)}</div>
<button onclick="location.href='${esc(retryHref)}'">${esc(buttonLabel)}</button>
</div>
</body></html>`
}

/** Pre-connect portal skeleton — the one shared by every JS-family SDK. */
export { portalSkeletonHtml }

/** Feedback-form skeleton — shared with react-native via @onelo/core. */
export { feedbackSkeletonHtml }
