/**
 * Store Hand-back (#615) — the ONE decoder for "the hosted page is finished"
 * in this SDK. The hosted store and Customer Portal navigate a native window to
 * `<scheme>://callback?…` (produced by one helper on the page,
 * frontend/lib/store-hand-back.ts, plus the portal's Done):
 *   `?code=`                      a purchase finished → exchange the code
 *   `?source=store&event=<r>`     a plan switch finished without a code
 *                                 (plan_switched | switch_scheduled |
 *                                 plan_switch_pending) — a success
 *   `?source=portal[&event=]`     the Customer Portal closed
 *   `?error=<code>`               the surface failed or its link is spent
 * Every window that shows a hosted page (store / auth window, portal window)
 * classifies navigations here, so a new terminal reaches both at once.
 *
 * Returns `null` for anything that is not `<protocol>://callback…`. Pure, so the
 * rule is testable without a BrowserWindow. The scheme is compared
 * case-insensitively (the OS lower-cases it).
 */
export type HandBack =
  | { kind: 'purchase'; code: string }
  | { kind: 'switched'; reason: string }
  | { kind: 'portal_closed'; event: string | null }
  | { kind: 'error'; error: string }

export function classifyHandBack(url: string, protocol: string): HandBack | null {
  const prefix = `${protocol}://`
  if (url.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== 'callback') return null
  const q = parsed.searchParams
  const source = q.get('source')
  if (source === 'store') return { kind: 'switched', reason: q.get('event') ?? '' }
  if (source === 'portal') return { kind: 'portal_closed', event: q.get('event') }
  const code = q.get('code')
  if (code) return { kind: 'purchase', code }
  const error = q.get('error')
  if (error) return { kind: 'error', error }
  return null
}
