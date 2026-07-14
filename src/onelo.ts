import { OneloElectronAuth } from './auth'
import { OneloFeatures } from './features'
import { OneloFeedback } from './feedback'
import { OneloMonitor } from './monitor'
import { OneloForms } from './forms'
import { OneloWaitlist } from './waitlist'
import { OneloElectronCustomerPortal } from './customer-portal'
import { OneloConsent } from './consent'
import { OneloStore } from './store'
import type { OneloElectronConfig } from './types'
import { getCachedCodesignFingerprint } from './codesign'
import { OneloEventStream } from './event-stream'
import { version as SDK_VERSION } from '../package.json'

export class Onelo {
  readonly auth: OneloElectronAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  readonly forms: OneloForms
  readonly waitlist: OneloWaitlist
  readonly customerPortal: OneloElectronCustomerPortal
  /** Legal-consent gate (Terms/Privacy updates for already-signed-in users). */
  readonly consent: OneloConsent
  /** Hosted store (checkout) + upgrade flow — the explicit monetization surface. */
  readonly store: OneloStore
  /** Shared SSE connection (real-time `session.revoked`, `paywall.access_changed`,
   *  `legal.consent_required`, and — once features adopts it — live feature
   *  deploys). One per app. */
  private readonly eventStream: OneloEventStream
  private readonly autoPresentConsentGate: boolean

  constructor(config: OneloElectronConfig) {
    if (!config.apiUrl) throw new Error('[Onelo] apiUrl is required')
    if (!config.publishableKey) throw new Error('[Onelo] publishableKey is required')
    getCachedCodesignFingerprint() // warm cache eagerly at startup
    this.auth = new OneloElectronAuth(config)
    // Default the Monitor app-version from Electron when the dev didn't supply it.
    let appVersion = config.appVersion
    if (!appVersion) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        appVersion = (require('electron') as typeof import('electron')).app.getVersion()
      } catch { /* non-electron / test — leave undefined */ }
    }
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl, {
      bundleId: config.bundleId,
      appVersion,
      appBuild: config.appBuild,
      environment: config.environment,
    })
    // Feature environment: explicit config wins; on the server (Node) fall back
    // to ONELO_FEATURE_ENVIRONMENT. Server detection uses `typeof window` — NOT
    // `typeof process`, which Webpack polyfills into client bundles (see memory
    // feedback_env_isserver_detection). Normalize to 'test'|'live' so a stray
    // value never ships as a junk query param.
    let envFromProcess: string | undefined
    if (typeof window === 'undefined') {
      // Read process.env via globalThis with a local type so a bundled renderer
      // build doesn't need @types/node and the bundler can't pull `process` in.
      const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      envFromProcess = proc?.env?.['ONELO_FEATURE_ENVIRONMENT']
    }
    const rawFeatureEnv = config.featureEnvironment ?? envFromProcess
    const featureEnvironment = rawFeatureEnv === 'test' || rawFeatureEnv === 'live' ? rawFeatureEnv : undefined
    this.features = new OneloFeatures(config.publishableKey, config.apiUrl, this.monitor, config.bundleId, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus,
    })
    this.feedback = new OneloFeedback({ publishableKey: config.publishableKey, apiUrl: config.apiUrl, bundleId: config.bundleId }, this.features)
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId)
    this.customerPortal = new OneloElectronCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      this.auth,
      config.protocol ?? 'onelo',
      config.bundleId,
    )
    // Auto-present the blocking consent gate on sign-in + `legal.consent_required`
    // SSE pushes (parity with Swift's OneloAuthView, which auto-gates). Set
    // `autoPresentConsentGate: false` to drive your own UI via
    // `consent.requiredConsents()` / `consent.onConsentRequired()` (the revision
    // + observers still fire; only the auto window-open is suppressed).
    this.autoPresentConsentGate = config.autoPresentConsentGate ?? true
    this.consent = new OneloConsent(
      config.apiUrl, config.publishableKey, this.auth, config.bundleId, this.autoPresentConsentGate,
    )
    this.store = new OneloStore(
      config.apiUrl, config.publishableKey, this.auth, config.protocol ?? 'onelo', config.bundleId,
    )
    // Shared SSE connection. Register ALL consumers' handlers BEFORE any start()
    // so an event pushed between connect and sign-in is never missed. Features
    // OWNS the stream lifecycle (its _load calls stream.start(userId)); auth just
    // attaches its `session.revoked` / `paywall.access_changed` listeners.
    // Pass bundleId so the SSE stream connect sends X-Bundle-Id — without it the
    // backend security gate 403s a live app with a registered bundle → realtime dead.
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION, config.bundleId)
    this.auth.attachEventStream(this.eventStream)
    this.features.attachEventStream(this.eventStream)
    // Consent always listens for `legal.consent_required` (bumps revision +
    // notifies observers); the window auto-opens only when autoPresent is on
    // (decided inside OneloConsent).
    this.consent.attachEventStream(this.eventStream)

    // Initial anonymous load — now that the stream is attached, this opens it.
    this.features._load(null)

    this.auth.onSessionChange((userId) => {
      this.monitor.setUserId(userId)
      // features._load re-opens the stream for the new identity (session.revoked
      // per-user routing) and refreshes targeting. Single stream driver.
      this.features._load(userId)
      // On sign-in / session-restore, re-check consent (a blocking legal version
      // may have been published while the user was away) — parity with Swift's
      // OneloAuthView onAppear/inApp check. presentGateIfNeeded no-ops when there
      // is nothing blocking or a gate is already open.
      if (userId && this.autoPresentConsentGate) void this.consent.presentGateIfNeeded()
    })

    // Boot: read the persisted session once. On a restored session, getSession
    // republishes identity via onSessionChange → rebinds features/monitor AND
    // opens the SSE stream for the user, so remote-logout works immediately after
    // an app restart. (No stored session → stays anonymous.)
    void this.auth.getSession().catch(() => { /* offline / no session — fine */ })

    // Lifecycle resync: under OS suspension (App Nap) the SSE socket + the
    // silence watchdog freeze, so the system wake/activate event is the only
    // reliable heal trigger. Reconnect the stream + force-refresh on resume.
    // Parity with Swift's NSWorkspace.didWake / willBecomeActive observers.
    if (config.autoLifecycleRefresh ?? true) {
      this._registerLifecycleResync()
    }
  }

  /** Wire powerMonitor 'resume' + app 'activate' → features._resyncOnLifecycle().
   *  Registered after app 'ready' (powerMonitor requires it); guarded for
   *  non-Electron / test contexts. */
  private _registerLifecycleResync(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app, powerMonitor } = require('electron') as typeof import('electron')
      const wire = (): void => {
        powerMonitor.on('resume', () => this.features._resyncOnLifecycle())
        app.on('activate', () => this.features._resyncOnLifecycle())
      }
      if (app.isReady()) wire()
      else void app.whenReady().then(wire)
    } catch {
      /* non-electron / test — no lifecycle events available */
    }
  }

  /** Identify the current user (your own auth). Sets features targeting + monitor
   *  user id. Pass `userIdHash` (HMAC computed on YOUR backend) for secure mode. */
  async identify(userId: string, userIdHash?: string): Promise<void> {
    await this.features._load(userId, userIdHash)
    this.monitor.setUserId(userId)
  }

  /**
   * Opens the hosted upgrade flow for `plan` in the SYSTEM BROWSER. The backend
   * decides the destination: an active subscriber lands on "Change plan" (target
   * pinned), a non-subscriber on the store. Requires a signed-in session.
   *
   * Wire it to a plan-gated tile whose `upgradeCta` is on:
   *   `if (f.upgradeCta && f.requiredPlan) onelo.openUpgrade(f.requiredPlan)`
   *
   * Thin delegate to {@link OneloStore.openUpgrade} for cross-platform parity with
   * Swift `Onelo.openUpgrade(forPlan:)` / Android / Flutter / RN `onelo.openUpgrade`.
   */
  async openUpgrade(plan: string, lang = 'en'): Promise<void> {
    return this.store.openUpgrade(plan, lang)
  }

  /** Drop the active identity WITHOUT a full session sign-out (identity-mode /
   *  own-auth only — Onelo Auth resets via onSessionChange). Parity with Swift
   *  Onelo.clearIdentity(). */
  async clearIdentity(): Promise<void> {
    await this.features._load(null)
    this.monitor.setUserId(null)
  }

  async destroy(): Promise<void> {
    // Stop the auth timers (heartbeat/refresh) + drop the identity bridge, and
    // stop the features poll timer — otherwise both survive teardown and keep
    // the Node event loop alive / keep re-driving features after destroy().
    // Parity with JS Onelo.destroy() (authUnsubscribe + features.stopPolling).
    this.auth.dispose()
    this.features.stopPolling()
    this.eventStream.destroy()
    await this.monitor.destroy()
  }
}
