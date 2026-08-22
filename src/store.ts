import { httpGet, extractErrorCode } from '@onelo/core'
import { OneloError } from './types'
import type { OneloElectronSession } from './types'
import { sdkHeaders } from './sdk-headers'
import type { OneloElectronAuth } from './auth'

/**
 * Monetization entry points — the Onelo hosted store (checkout / plan selection)
 * and the upgrade flow. Ports Swift's `OneloAuth.initiateStoreFlow()` +
 * `Onelo.openUpgrade(forPlan:)`.
 *
 * The AUTOMATIC "you must buy to proceed" store (sign-up → store when the paywall
 * is on) is handled server-side by the hosted auth page — you get that for free
 * via `auth.loadAuthView()`. THIS class is the EXPLICIT surface: a re-purchase, an
 * "Upgrade" button, or acting on a feature's `upgradeCta`/`upgradeHint` upsell.
 *
 * Backend: `GET /api/sdk/paywall/store-initiate` + `GET /api/sdk/paywall/upgrade-initiate`.
 *
 * Usage:
 *   const session = await onelo.store.open(mainWindow)   // buyer ends up signed in
 *   await onelo.store.openInBrowser()                    // store in system browser
 *   await onelo.store.openUpgrade('pro')                 // upgrade in system browser
 */
export class OneloStore {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly auth: OneloElectronAuth
  private readonly bundleId?: string
  private readonly protocol: string

  constructor(
    apiUrl: string,
    publishableKey: string,
    auth: OneloElectronAuth,
    /** Deep-link scheme for the checkout callback (same one auth uses). */
    protocol: string,
    bundleId?: string,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.auth = auth
    this.bundleId = bundleId
    // Backend lowercases the callback scheme before storing, so the final
    // redirect is always lowercase — normalize once so interception matches
    // (parity with customer-portal).
    this.protocol = protocol.toLowerCase()
  }

  /**
   * Mint a tokenized hosted-store URL (plan selection + payment + registration in
   * one page). When a session exists its access token is attached (`Authorization:
   * Bearer`) so the store binds to the existing user and skips signup (re-purchase);
   * cold-start omits it. Mirrors Swift `initiateStoreFlow(lang:)`. Use for a custom
   * presentation; `open()`/`openInBrowser()` wrap it.
   *
   * @throws OneloError('server_error') on `store_not_configured` (409) /
   *   `paywall_not_enabled` (403) — DO NOT open a window in that case — or any
   *   other non-200. `OneloError('invalid_publishable_key')` on 401.
   */
  async initiateStoreFlow(lang = 'en'): Promise<string> {
    const session = await this.auth.getSession()
    const initiateUrl =
      `${this.apiUrl}/api/sdk/paywall/store-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&callback_scheme=${encodeURIComponent(this.protocol)}` +
      `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(
      initiateUrl,
      // Bearer only when signed in (re-purchase binding); anonymous store omits it.
      sdkHeaders(this.bundleId, session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    )
    if (status === 401) throw OneloError.invalidKey('Store rejected the publishable key')
    if (status !== 200) {
      const code = extractErrorCode(json)
      // e.g. store_not_configured (409), paywall_not_enabled (403),
      // in_app_store_not_allowed (409).
      throw OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ''}`)
    }
    const storeUrl = (json as Record<string, unknown>)['store_url'] as string | undefined
    if (!storeUrl) throw OneloError.server('Invalid store-initiate response: missing store_url')
    return storeUrl
  }

  /**
   * Open the hosted store in an in-app BrowserWindow and complete checkout — the
   * recommended path, and the 1:1 Electron equivalent of Swift's OneloAuthView:
   * the plan selection renders in the window; when the hosted page `window.open`s
   * the Stripe checkout, [OneloElectronAuth.presentHostedUrl]'s
   * `setWindowOpenHandler` sends THAT (and only that) to the system browser via
   * `shell.openExternal`. The store completes with a `<protocol>://…?code=`
   * deep-link that is exchanged for a session — the buyer ends up signed in.
   * Resolves with that session (or null if the window closed without completing,
   * in which case the session arrives via your `handleDeepLink`).
   *
   * @param parentWindow  Pass your main window to present modally.
   */
  async open(parentWindow?: import('electron').BrowserWindow): Promise<OneloElectronSession | null> {
    const storeUrl = await this.initiateStoreFlow()
    return this.auth.presentHostedUrl(storeUrl, parentWindow, 'Store')
  }

  /**
   * Open the hosted store in the user's DEFAULT SYSTEM BROWSER (via
   * `shell.openExternal`). Preferred for the payment surface — the buyer sees the
   * real domain + their saved cards / password manager. The store redirects back
   * via your deep-link scheme on completion; wire `app.on('open-url')` (macOS) /
   * `second-instance` (win/linux) to `auth.handleDeepLink(url)` to finish sign-in.
   */
  async openInBrowser(lang = 'en'): Promise<void> {
    const storeUrl = await this.initiateStoreFlow(lang)
    const { shell } = await import('electron')
    await shell.openExternal(storeUrl)
  }

  /**
   * Act on an upsell (a feature's `upgradeCta`/`upgradeHint`, an "Available in
   * <plan>" tap). Requires a signed-in session. The backend is the single source
   * of truth for billing: an active subscriber is routed to a hosted plan-switch
   * checkout, a user with no subscription to the hosted store. The resulting URL
   * opens in the SYSTEM BROWSER (mirrors Swift `openUpgrade(forPlan:)` /
   * `NSWorkspace.open`). Mirrors Swift — never opens an in-app window.
   *
   * @throws OneloError('not_authenticated') when signed out (401) or
   *   `OneloError('server_error')` on `plan_not_purchasable` (404) /
   *   `callback_scheme_required` (400) / any other non-200.
   */
  async openUpgrade(plan: string, lang = 'en'): Promise<void> {
    const session = await this.auth.getSession()
    if (!session) throw OneloError.notAuthenticated()

    const initiateUrl =
      `${this.apiUrl}/api/sdk/paywall/upgrade-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&plan=${encodeURIComponent(plan)}` +
      `&callback_scheme=${encodeURIComponent(this.protocol)}` +
      `&lang=${encodeURIComponent(lang)}`

    const { status, json } = await httpGet(
      initiateUrl,
      sdkHeaders(this.bundleId, { Authorization: `Bearer ${session.accessToken}` }),
    )
    if (status === 401) throw OneloError.notAuthenticated()
    if (status !== 200) {
      const code = extractErrorCode(json)
      // e.g. plan_not_purchasable (404), callback_scheme_required (400),
      // in_app_store_not_allowed (409).
      throw OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ''}`)
    }
    const upgradeUrl = (json as Record<string, unknown>)['upgrade_url'] as string | undefined
    if (!upgradeUrl) throw OneloError.server('Invalid upgrade-initiate response: missing upgrade_url')
    const { shell } = await import('electron')
    await shell.openExternal(upgradeUrl)
  }
}
