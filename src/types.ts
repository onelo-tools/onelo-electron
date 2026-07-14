export type { UserRole, OneloUser, OneloSession, ResolvedSDKConfig } from '@onelo/core'
export { OneloError } from '@onelo/core'

// Aliases for backwards compatibility
export type { OneloUser as OneloElectronUser, OneloSession as OneloElectronSession } from '@onelo/core'

export interface OneloElectronConfig {
  /** Publishable key from Onelo dashboard (onelo_pk_live_...) */
  publishableKey: string
  /** Onelo API base URL — required. Get this from your Onelo dashboard snippet. */
  apiUrl: string
  /** Custom deep-link protocol for hosted auth callback, e.g. "myapp" → myapp://callback */
  protocol?: string
  /** Client secret for server/desktop app type */
  clientSecret?: string
  /** App bundle identifier (e.g. "com.example.myapp"). Required for live apps with registered bundle IDs. */
  bundleId?: string
  /**
   * Suppress the "no userId — call onelo.identify()" console warning that fires when
   * features resolve in anonymous mode while targeted features exist. Set to true if
   * your app is intentionally anonymous. Default: false.
   */
  suppressIdentifyWarning?: boolean
  /**
   * Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll.
   * When set it wins over the publishable key prefix on the backend. When omitted, the
   * SDK falls back to the ONELO_FEATURE_ENVIRONMENT env var; if neither is set the field
   * is not sent and the backend derives the environment from the key prefix (compat).
   * See docs/architecture/feature-environment-explicit.md.
   */
  featureEnvironment?: string
  /**
   * Auto-present the blocking legal-consent gate on sign-in and on
   * `legal.consent_required` SSE pushes (parity with Swift's OneloAuthView).
   * Default: true. Set false to build your own consent UI — `consent.consentRevision`,
   * `consent.onConsentRequired()`, and `consent.requiredConsents()` still work.
   */
  autoPresentConsentGate?: boolean
  /**
   * Deployment environment label for Monitor events ("production" | "staging" |
   * "dev"). Auto-attached as `meta.environment` (Environment column). A per-event
   * meta.environment overrides. Distinct from `featureEnvironment` (test/live).
   */
  environment?: string
  /**
   * Host app version → Monitor `meta.app.version`. Defaults to Electron's
   * `app.getVersion()` when omitted.
   */
  appVersion?: string
  /** Host app build number → Monitor `meta.app.build`. */
  appBuild?: string
  /**
   * Re-sync features on OS resume / app re-activate (heals the SSE socket + REST
   * after App Nap suspends them). Default: true. Parity with Swift's lifecycle
   * observers.
   */
  autoLifecycleRefresh?: boolean
  /**
   * Status returned by `onelo.features.feature(name)` for a slug not (yet) in the
   * resolved snapshot. Fail-closed 'hidden' by default — a feature instrumented in
   * code but not enabled in the dashboard stays hidden in production. Set 'enabled'
   * in dev to preview new gates before toggling them. 1:1 with Swift
   * `Onelo(featureDefaultStatus:)`.
   */
  featureDefaultStatus?: 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon'
}

export const IPC_CHANNELS = {
  GET_SESSION: 'onelo:get-session',
  SIGN_IN: 'onelo:sign-in',
  SIGN_OUT: 'onelo:sign-out',
  REFRESH_SESSION: 'onelo:refresh-session',
  OPEN_AUTH_URL: 'onelo:open-auth-url',
} as const
