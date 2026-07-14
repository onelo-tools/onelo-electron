import * as electron from 'electron';
import { OneloSession, OneloEntitlement } from '@onelo/core';
export { OneloSession as OneloElectronSession, OneloUser as OneloElectronUser, OneloError, REASON_LABELS, RESPONSE_REASON_CODES, ResolvedSDKConfig, ResponseReasonCode, UserRole } from '@onelo/core';

interface OneloElectronConfig {
    /** Publishable key from Onelo dashboard (onelo_pk_live_...) */
    publishableKey: string;
    /** Onelo API base URL — required. Get this from your Onelo dashboard snippet. */
    apiUrl: string;
    /** Custom deep-link protocol for hosted auth callback, e.g. "myapp" → myapp://callback */
    protocol?: string;
    /** Client secret for server/desktop app type */
    clientSecret?: string;
    /** App bundle identifier (e.g. "com.example.myapp"). Required for live apps with registered bundle IDs. */
    bundleId?: string;
    /**
     * Suppress the "no userId — call onelo.identify()" console warning that fires when
     * features resolve in anonymous mode while targeted features exist. Set to true if
     * your app is intentionally anonymous. Default: false.
     */
    suppressIdentifyWarning?: boolean;
    /**
     * Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll.
     * When set it wins over the publishable key prefix on the backend. When omitted, the
     * SDK falls back to the ONELO_FEATURE_ENVIRONMENT env var; if neither is set the field
     * is not sent and the backend derives the environment from the key prefix (compat).
     * See docs/architecture/feature-environment-explicit.md.
     */
    featureEnvironment?: string;
    /**
     * Auto-present the blocking legal-consent gate on sign-in and on
     * `legal.consent_required` SSE pushes (parity with Swift's OneloAuthView).
     * Default: true. Set false to build your own consent UI — `consent.consentRevision`,
     * `consent.onConsentRequired()`, and `consent.requiredConsents()` still work.
     */
    autoPresentConsentGate?: boolean;
    /**
     * Deployment environment label for Monitor events ("production" | "staging" |
     * "dev"). Auto-attached as `meta.environment` (Environment column). A per-event
     * meta.environment overrides. Distinct from `featureEnvironment` (test/live).
     */
    environment?: string;
    /**
     * Host app version → Monitor `meta.app.version`. Defaults to Electron's
     * `app.getVersion()` when omitted.
     */
    appVersion?: string;
    /** Host app build number → Monitor `meta.app.build`. */
    appBuild?: string;
    /**
     * Re-sync features on OS resume / app re-activate (heals the SSE socket + REST
     * after App Nap suspends them). Default: true. Parity with Swift's lifecycle
     * observers.
     */
    autoLifecycleRefresh?: boolean;
    /**
     * Status returned by `onelo.features.feature(name)` for a slug not (yet) in the
     * resolved snapshot. Fail-closed 'hidden' by default — a feature instrumented in
     * code but not enabled in the dashboard stays hidden in production. Set 'enabled'
     * in dev to preview new gates before toggling them. 1:1 with Swift
     * `Onelo(featureDefaultStatus:)`.
     */
    featureDefaultStatus?: 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
}
declare const IPC_CHANNELS: {
    readonly GET_SESSION: "onelo:get-session";
    readonly SIGN_IN: "onelo:sign-in";
    readonly SIGN_OUT: "onelo:sign-out";
    readonly REFRESH_SESSION: "onelo:refresh-session";
    readonly OPEN_AUTH_URL: "onelo:open-auth-url";
};

type SseHandler = (data: Record<string, unknown>) => void;
type ParamProvider = () => Record<string, string>;
declare class OneloEventStream {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly sdkVersion?;
    private readonly bundleId?;
    private controller;
    private readonly handlers;
    private readonly paramProviders;
    private userId;
    private started;
    private destroyed;
    private reconnectAttempts;
    private reconnectTimer;
    private silenceTimer;
    /** Fired when the server caps the connection (429, X-Fallback: poll) and the
     *  stream stops — a consumer (features) can start polling instead. */
    private onFallbackCb;
    private connEpoch;
    constructor(apiUrl: string, publishableKey: string, sdkVersion?: string | undefined, bundleId?: string | undefined);
    /**
     * Register a handler for a named server event (`connected`, `features_updated`,
     * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
     * in a module constructor) so no event is missed between connect and sign-in.
     */
    on(event: string, handler: SseHandler): void;
    /**
     * Extra query params, read fresh on EVERY (re)connect — for values that change
     * over the connection's life (e.g. features' `since_version`), so a reconnect
     * always sends the current value.
     */
    addParamProvider(fn: ParamProvider): void;
    /** Register a callback fired when a 429 connection-cap stops the stream, so a
     *  consumer can fall back to polling (honours the backend's X-Fallback: poll). */
    onFallback(cb: () => void): void;
    /**
     * Open (or re-open) the connection for a user. Idempotent: a repeat call with
     * the same userId while already connected is a no-op. A changed userId
     * reconnects so per-user routing (features + `session.revoked` targeting) is
     * correct.
     */
    start(userId: string | null): void;
    /** Close the connection and cancel any pending reconnect. */
    stop(): void;
    /** Permanent teardown — cannot be restarted. */
    destroy(): void;
    /**
     * Force a fresh connection NOW, re-reading all params. Used after a consumer
     * resets a provider value (e.g. features' `invalidateCache()` → `since_version
     * = 0`, so only a reconnect makes the server resend a full snapshot). No-op
     * when not started or destroyed.
     */
    reconnect(): void;
    private _buildUrl;
    private _connect;
    /** Parse one SSE frame (`event:`/`data:` lines) and dispatch to handlers. */
    private _dispatchFrame;
    private _armSilence;
    private _scheduleReconnect;
    private _clearReconnect;
    private _clearSilence;
    private _abort;
}

declare class OneloElectronAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private clientSecret;
    private protocol;
    private pkceVerifier;
    private resolvedConfig;
    private heartbeatTimer;
    private refreshTimer;
    private static readonly HEARTBEAT_MS;
    /** Refresh this many seconds before the access token expires. */
    private static readonly REFRESH_LEAD_SECONDS;
    private initPromise;
    private _sessionListeners;
    /** Incremented on signOut so an in-flight refresh/revalidate can't resurrect a
     *  session that was signed out mid-request (epoch guard — parity with Swift/JS). */
    private signOutEpoch;
    /** Whether the app has the paywall enabled — gates the entitlement revalidate
     *  on session restore (only paywall apps care about `hasActiveAccess`). */
    private paywallEnabled;
    /** App bundle id — sent as X-Bundle-Id on every SDK request. The backend's
     *  validate_sdk_request_security REQUIRES it on live keys for the electron
     *  app_type once a bundle is registered (403 invalid_bundle_id otherwise), and
     *  it gates test-env feature discovery. Threaded to match the sibling modules
     *  (store/forms/waitlist/portal). The /api/sdk/config bootstrap call is the one
     *  exception — it runs before any bundle is known and isn't bundle-gated. */
    private readonly bundleId?;
    /** True after a hard account revocation (banned / all sessions server-revoked)
     *  surfaced via the SSE `session.revoked` push, heartbeat 401, or refresh
     *  `user_revoked`. Parity with Swift `isUserRevoked` / JS. */
    isUserRevoked: boolean;
    /**
     * Register a callback invoked whenever the session changes (sign-in, restore,
     * or sign-out), receiving the new user id (or `null`). Returns an unsubscribe
     * function. Multi-listener + unsubscribe to match JS `onAuthStateChange`
     * (listener array) and Swift's Combine `currentSession` (multi-observer) — was
     * a single slot that silently overwrote a prior registration. The payload
     * stays `userId: string | null` (the internal Onelo wrapper bridge relies on
     * it to rebind features/monitor identity), NOT the full session object.
     */
    onSessionChange(cb: (userId: string | null) => void): () => void;
    /** Fire every registered session listener. Snapshots the array first so a
     *  listener that unsubscribes mid-dispatch doesn't skip its peers, and isolates
     *  a throwing listener so it can never break the auth state machine. */
    private _notifySessionChange;
    /** True once /api/sdk/config has been fetched successfully */
    isReady: boolean;
    /** True if the publishable key has been revoked */
    isRevoked: boolean;
    /** Whether the tenant's plan allows custom auth UI */
    allowCustomBranding: boolean;
    /** App name from dashboard — shown in hosted sign-in UI */
    appName: string;
    /** App logo URL from dashboard — shown in hosted sign-in UI if set */
    appLogoUrl: string | null;
    /** Plan-gated enabled OAuth providers (google/github/apple) from
     *  /api/sdk/config. Empty when social is disabled. Parity with Swift. */
    oauthProviders: string[];
    constructor(config: OneloElectronConfig);
    private initialize;
    private waitReady;
    /**
     * Resolves when /api/sdk/config has been fetched. Safe to call multiple times.
     * Pass `timeoutSeconds` to reject with `OneloError.timeout` if the SDK isn't
     * ready in time (so startup UI / monitor events don't hang forever on a slow
     * config fetch). No arg = wait indefinitely (back-compat). Parity with Swift
     * `awaitReady(timeout:)` (whose default is 5s — pass 5 to match).
     */
    whenReady(timeoutSeconds?: number): Promise<void>;
    /**
     * Generate a fresh PKCE verifier AND register its challenge with the backend
     * (GET /api/sdk/config?code_challenge=…), then stash the verifier for the next
     * signin/signup POST. The challenge is single-use — reusing a verifier whose
     * challenge was already consumed (or one whose challenge was never registered)
     * fails the exchange. Called before every signin/signup so retries always work.
     */
    private _ensurePkce;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    /**
     * True when the current session's user has an active paid entitlement.
     * Snapshot read of the persisted session (no network) — mirrors Swift's
     * `hasActiveAccess`. Returns false when there is no session.
     */
    hasActiveAccess(): Promise<boolean>;
    /**
     * True when this app has the paywall enabled (from `/api/sdk/config`). Lets a
     * launch gate decide whether a session ALONE is enough to enter (non-paywall
     * apps) or whether `hasActiveAccess()` must ALSO hold (paywall apps) — without
     * the developer hardcoding a duplicate flag that could drift from the dashboard.
     * Accurate only after `whenReady()` resolves; returns false before config loads.
     */
    isPaywallEnabled(): boolean;
    /**
     * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
     * + persist the session so `hasActiveAccess()` and the onSessionChange bridge
     * see the new value. Call after an external checkout or on app resume.
     * Best-effort: returns the cached entitlement on any non-200/network failure
     * and never throws (mirrors Swift/JS `revalidateEntitlement`).
     */
    revalidateEntitlement(): Promise<OneloEntitlement>;
    /**
     * Wire the shared event stream (called once by `Onelo`). Registers real-time
     * auth pushes: `session.revoked` (server-side force-logout — refund lapse,
     * admin revoke, account deletion, ban → sub-second sign-out, the complement to
     * the ≤13-min heartbeat fallback) and `paywall.access_changed` (a per-user
     * entitlement change → revalidate). Registered once; survives sign-in/out
     * cycles, exactly like the Swift SDK.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Handle a `session.revoked` push. Filters to the current user (one app can
     * have multiple buyers multiplexed on the shared stream); a missing
     * `app_user_id` is treated as "current user" (forward-compat). No session →
     * ignore. Teardown mirrors the refresh `user_revoked` path exactly.
     */
    private _handleSessionRevoked;
    refreshSession(): Promise<OneloSession | null>;
    /**
     * Open the Onelo hosted auth page in an in-app BrowserWindow.
     * Handles the deep-link callback automatically — no app.on('open-url') needed.
     * Works on both free and paid plans. On free plan the hosted page includes Onelo branding.
     *
     * @param parentWindow  Optional parent BrowserWindow (for modal centering)
     */
    presentAuthWindow(parentWindow?: electron.BrowserWindow): Promise<OneloSession | null>;
    /**
     * Present any Onelo-hosted flow URL (sign-in, store, …) in an in-app
     * BrowserWindow and complete it: a `<protocol>://…?code=` deep-link is
     * exchanged for a session (the user/buyer ends up signed in), while OAuth
     * provider pages are punted to the system browser (RFC 8252 — embedded
     * webviews are blocked/insecure). Resolves with the session, or null if the
     * window closed without a same-window code (e.g. OAuth handed off to the
     * browser — the session then arrives via app.on('open-url') → handleDeepLink).
     * Shared by presentAuthWindow and the store flow (OneloStore).
     */
    presentHostedUrl(hostedUrl: string, parentWindow?: electron.BrowserWindow, title?: string): Promise<OneloSession | null>;
    /**
     * Open the Onelo hosted sign-in page in the system default browser.
     * You must call handleDeepLink() from app.on('open-url') to complete the flow.
     *
     * @param onUrl  Optional callback to receive the hosted URL instead of opening it automatically
     */
    presentHostedSignIn(onUrl?: (url: string) => void): Promise<void>;
    /**
     * Resolve the SINGLE next flow step from the backend, sending the current
     * session as a Bearer so /api/sdk/flow/init can decide `authorized` (already
     * signed in + entitled → no UI) vs `present` (open the hosted sign-in OR store
     * URL). This REPLACES the old always-present `/api/sdk/auth/initiate` — the
     * sign-in↔store↔content routing now lives once, behind Onelo's walls (parity
     * with Swift `resolveFlow` and JS `auth.ts:197`). Waitlist mode is surfaced as
     * a `present` so callers open it exactly like any hosted URL.
     */
    private resolveFlow;
    /**
     * Handle a deep link URL from the OS open-url event.
     * Call this from your app's `open-url` handler (app.on('open-url', ...)).
     * Returns the session if the URL contains a valid auth code, null otherwise.
     */
    handleDeepLink(url: string): Promise<OneloSession | null>;
    /**
     * Show a built-in auth UI adapted to the tenant's plan.
     *
     * - Free plan (`allowCustomBranding === false`): delegates to `presentAuthWindow` — shows the
     *   Onelo-hosted page (with Onelo branding).
     * - Paid plan (`allowCustomBranding === true`): opens a modal BrowserWindow with a built-in
     *   email/password form that matches the app's name and logo.
     *
     * @param parentWindow  Optional parent BrowserWindow (centers/modals the auth window).
     * @returns             Resolves with a session after successful sign-in or sign-up.
     */
    loadAuthView(parentWindow?: electron.BrowserWindow): Promise<OneloSession | null>;
    sendMagicLink(email: string, redirectTo?: string): Promise<void>;
    sendPasswordReset(email: string, redirectTo?: string): Promise<void>;
    private saveSession;
    /**
     * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
     * before it expires. Idempotent — cancels any pending refresh first. Without this,
     * an idle app would carry a stale token past its TTL and the next request would 401.
     */
    private scheduleRefresh;
    private clearRefreshTimer;
    /**
     * Tear down this module's background timers + the identity bridge so the
     * Electron process can exit cleanly. Called by `Onelo.destroy()`. This does
     * NOT sign out (no server revoke, tokens stay in storage) — it only stops the
     * SDK's own `setInterval`/`setTimeout` and drops the single-slot session
     * callback so it can't re-drive features/monitor after teardown. Parity with
     * JS `Onelo.destroy()` (authUnsubscribe + stopped timers).
     */
    dispose(): void;
    private startHeartbeat;
    private stopHeartbeat;
}

/** Error codes for OneloFeatures.moduleToken (parity with Swift OneloFeaturesError). */
type OneloFeaturesErrorCode = 'notAuthenticated' | 'notEntitled' | 'secureModeRequired' | 'invalidUserHash' | 'networkError';
/** Typed error thrown by `moduleToken()`. Mirrors Swift's `OneloFeaturesError` enum. */
declare class OneloFeaturesError extends Error {
    readonly code: OneloFeaturesErrorCode;
    constructor(code: OneloFeaturesErrorCode);
}
type FeatureStatus = 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
/** Why a feature is in its state. A present-but-unknown reason from a newer
 *  backend normalizes to 'unknown' (mirrors Swift/JS) rather than dropping the
 *  feature. */
type FeatureReason = 'user_override' | 'plan' | 'default' | 'static' | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown';
/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 *  is available or not plan-gated. Parity with JS. */
interface UpgradeHint {
    requiredPlan: string;
    currentStatus: FeatureStatus;
}
/** IPC-safe plain snapshot of a {@link FeatureState} — every computed getter
 *  (isEnabled / isVisible / badgeLabel / upgradeHint / …) materialized as an OWN
 *  data property. Electron's structured-clone IPC (`webContents.send` /
 *  `ipcMain.handle` return) copies ONLY own enumerable data props and drops the
 *  prototype + accessors, so sending a raw `FeatureState` across the boundary makes
 *  `isVisible`/`isEnabled`/`badgeLabel` arrive `undefined` in the renderer — and a
 *  `!isVisible` render guard then hides EVERY feature. Send this snapshot instead
 *  (via `feature(name).toJSON()` or `features.featureSnapshot(name)`). */
interface FeatureSnapshot {
    name: string;
    status: FeatureStatus;
    reason?: FeatureReason;
    requiredPlan?: string;
    requiredPlanLabel?: string;
    upgradeCta: boolean;
    isEnabled: boolean;
    isDisabled: boolean;
    isVisible: boolean;
    isGreyed: boolean;
    isUpsell: boolean;
    isNew: boolean;
    isBeta: boolean;
    isComingSoon: boolean;
    badgeLabel: string | null;
    upgradeHint: UpgradeHint | null;
}
declare class FeatureState {
    readonly name: string;
    readonly status: FeatureStatus;
    /** Why the feature is in this state (plan-gated, user override, …). */
    readonly reason?: FeatureReason;
    /** Machine key of the plan that unlocks this feature — render the label. */
    readonly requiredPlan?: string;
    /** Human label of the unlocking plan (e.g. "Pro"). */
    readonly requiredPlanLabel?: string;
    /** The developer enabled "tap to upgrade" for this feature (backend flag). */
    readonly upgradeCta: boolean;
    constructor(name: string, status: FeatureStatus, reason?: FeatureReason, requiredPlan?: string, requiredPlanLabel?: string, upgradeCta?: boolean);
    get isEnabled(): boolean;
    get isDisabled(): boolean;
    get isVisible(): boolean;
    get isGreyed(): boolean;
    get isUpsell(): boolean;
    get isNew(): boolean;
    get isBeta(): boolean;
    get isComingSoon(): boolean;
    /** Promo/lock badge (parity with Swift/JS): New/Beta/Coming Soon, 🔒 for greyed
     *  (locked — never hide it), and "Available in <plan>" for upsell. */
    get badgeLabel(): string | null;
    /** Non-null when the feature is plan-blocked AND the backend named the
     *  unlocking plan — surface in upgrade-prompt UI (parity with JS). */
    get upgradeHint(): UpgradeHint | null;
    /** IPC-safe plain object — every computed getter materialized as a data property
     *  so it survives Electron structured-clone IPC (`webContents.send` /
     *  `ipcMain.handle`), which drops prototype accessors. Send THIS across IPC, not
     *  the FeatureState instance. Also used automatically by `JSON.stringify`. */
    toJSON(): FeatureSnapshot;
}
interface OneloFeaturesOptions {
    /** Suppress the anonymous-mode identify() warning. See OneloElectronConfig.suppressIdentifyWarning. */
    suppressIdentifyWarning?: boolean;
    /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll. See OneloElectronConfig.featureEnvironment. */
    featureEnvironment?: string;
    /** Status returned by feature() for a slug not (yet) in the snapshot. Fail-closed
     *  'hidden' by default; 'enabled' in dev previews new gates. 1:1 with Swift
     *  `featureDefaultStatus`. See OneloElectronConfig.featureDefaultStatus. */
    featureDefaultStatus?: FeatureStatus;
}
declare class OneloFeatures {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly bundleId?;
    private readonly featureEnvironment?;
    private cache;
    private discovered;
    private configVersion;
    private pollTimer;
    private pingDebounce;
    private monitor;
    private suppressIdentifyWarning;
    private anonymousWarningLogged;
    /** Status returned by feature() for a slug not in the snapshot (default 'hidden'). */
    private readonly defaultStatus;
    /** In-memory observers notified AFTER any cache change (SSE Deploy push,
     *  lifecycle resync, invalidateCache). Purely local fan-out — no network/DB/SSE.
     *  In Electron the SDK runs in the MAIN process; forward these to the renderer
     *  over IPC (main subscribe → webContents.send) so the UI re-renders on a Deploy. */
    private readonly changeListeners;
    /** Shared SSE stream (real-time deploys). When present, it is the primary
     *  update channel; the 60s poll runs ONLY as the fallback when the stream is
     *  capped out (429 → X-Fallback: poll). */
    private stream;
    private currentUserId;
    /** HMAC-SHA256(secretKey, "user:"+userId), computed on the DEVELOPER's backend
     *  and passed via identify(userId, userIdHash). The SDK never computes it. Sent
     *  on resolve/batch-ping/poll/stream for secure mode. Null = not secure mode. */
    private currentUserIdHash;
    private streamActive;
    /** True once the first SSE `connected`/`up_to_date` (or a successful resolve)
     *  has landed — gates `ready()` (parity with Swift firstEventReceived). */
    private firstEventReceived;
    private readyWaiters;
    /** Debounce for refresh() (parity with Swift 1s). */
    private lastRefreshAt;
    private static readonly REFRESH_DEBOUNCE_MS;
    constructor(publishableKey: string, apiUrl: string, monitor?: {
        _trackFeatureCall: (name: string) => void;
        recordFlag?: (key: string, value: string) => void;
    } | null, bundleId?: string, options?: OneloFeaturesOptions);
    /**
     * Subscribe to feature-cache changes so the host can re-render / forward to the
     * renderer the instant a fresh snapshot lands (SSE Deploy, lifecycle resync,
     * invalidateCache). Fires AFTER the cache is updated; re-read feature(name)
     * inside. Purely local (no network/DB/SSE). Returns an unsubscribe fn. In
     * Electron, wire it to `webContents.send` to push updates to the renderer UI.
     * Parity with the RN/JS `subscribe()`.
     */
    subscribe(listener: () => void): () => void;
    /** Notify subscribers after a cache mutation. A throwing listener never breaks
     *  cache application. */
    private _emitChange;
    /** Convenience: `true` when the feature resolves to an active status
     *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. Parity with RN. */
    isEnabled(name: string): boolean;
    /** IPC-safe snapshot of a feature — a plain object with every computed getter
     *  materialized as a data property. Return THIS from an `ipcMain.handle` /
     *  `webContents.send` handler in the main process; a raw `feature()` result loses
     *  its getters over structured-clone IPC and every feature would read as hidden. */
    featureSnapshot(name: string): FeatureSnapshot;
    feature(name: string): FeatureState;
    declare(names: string[]): void;
    getActiveFeatures(): string[];
    /**
     * Mint a short-lived entitlement token for `slug` — proof the current user is
     * entitled to that feature, verifiable by your backend. Requires an identified
     * user. Parity with Swift `moduleToken(for:)`.
     *
     * @throws OneloFeaturesError — `notAuthenticated` (no user, no network),
     *   `notEntitled` (403), `secureModeRequired`/`invalidUserHash` (401 secure
     *   mode), `networkError` (anything else, incl. the backend's current 503).
     */
    moduleToken(slug: string): Promise<string>;
    /**
     * Wire the shared SSE stream (called once by Onelo, before the first _load).
     * Registers the snapshot handlers + the dynamic `since_version` param provider
     * (read fresh on every reconnect). When attached, the stream is the primary
     * update channel and polling is off — unless a 429 cap forces the poll fallback.
     */
    attachEventStream(stream: OneloEventStream): void;
    _load(userId: string | null, userIdHash?: string | null): Promise<void>;
    private _applySnapshot;
    /** Coerce a persisted cache value back to a FeatureRecord, re-normalizing the
     *  status defensively (a value persisted by an older/newer SDK). */
    private _coerceRecord;
    /** Resolve all pending `ready()` waiters once the first event lands. Idempotent. */
    private _signalFirstEvent;
    /**
     * Await the first feature snapshot/handshake so the app can render
     * feature-dependent UI without a cold-start flicker — but never block longer
     * than `timeoutMs` (default 1500). Resolves immediately if already ready.
     * Parity with Swift `ready(timeout:)`.
     */
    ready(timeoutMs?: number): Promise<void>;
    /**
     * Manually re-resolve features from the backend (e.g. after a checkout or on
     * app resume). Debounced to 1s unless `force` is true. Never throws. Parity
     * with Swift `refresh(force:)`.
     */
    refresh(force?: boolean): Promise<void>;
    /**
     * Re-sync on app lifecycle (resume from sleep / window re-activate). Under OS
     * suspension the SSE socket + the silence watchdog are both frozen, so the
     * system wake event is the only reliable heal trigger. Reconnects the stream
     * and force-refreshes over REST. Parity with Swift `_resyncOnLifecycle`.
     */
    _resyncOnLifecycle(): void;
    /** Stop background polling. Call when the SDK is no longer needed. */
    stopPolling(): void;
    /** Clears the local feature cache and resets the config version. Forces the
     *  stream to resend a full snapshot (since_version=0) — a live connection stays
     *  silent otherwise. */
    invalidateCache(): void;
    _stopPolling(): void;
    private _scheduleBatchPing;
    private _batchPing;
    private _resolve;
    /**
     * Logs a one-time warning when the backend reports anonymous mode (no userId)
     * AND at least one targeted feature was hidden purely because of it. Helps
     * developers using their own auth system catch missing identify() calls.
     */
    private _maybeWarnAnonymous;
    private _poll;
    private _startPolling;
}

interface FeedbackConfig {
    publishableKey: string;
    apiUrl: string;
    bundleId?: string;
}
interface OpenOptions {
    type?: 'bug' | 'feature_request' | 'general';
    area?: string;
    userId?: string;
}
declare class OneloFeedback {
    private readonly config;
    private readonly features;
    private window;
    constructor(config: FeedbackConfig, features: OneloFeatures);
    /** No-op shim — session context is now derived from active feature flags automatically. */
    track(_area: string): void;
    buildInitiateUrl(options?: OpenOptions): string;
    open(options?: OpenOptions): void;
    private _openAsync;
    /** Show the skeleton, resolve the hosted URL, and navigate the WebView. On
     *  failure renders an in-window error screen WITH a Retry button (never a
     *  silent close). Retry (the button's onelo://feedback_retry nav → handleNav)
     *  re-invokes this exact method — 1:1 with Swift's loadHostedForm/onRetry. */
    private _loadHostedForm;
    /** Render an error screen WITH a "Try again" button inside the feedback window
     *  instead of silently closing (no-silent-swallows). The button navigates to
     *  the onelo://feedback_retry sentinel, which handleNav (installed once in
     *  _openAsync) intercepts → re-runs _loadHostedForm in the SAME window. This is
     *  the 1:1 parity with Swift's errorHTML + onRetry (JS just throws — no retry). */
    private _showError;
}

interface MonitorEventOptions {
    ok: boolean;
    durationMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
}
/** Host-app context for Monitor events (parity with Swift MonitorAppContext + JS MonitorContext). */
interface MonitorContext {
    /** App bundle id → meta.app.bundleId + X-Bundle-Id header. */
    bundleId?: string;
    /** Host app version (e.g. app.getVersion()) → meta.app.version. */
    appVersion?: string;
    /** Host app build number → meta.app.build. */
    appBuild?: string;
    /** Deployment tag ("production"|"staging"|"dev") → meta.environment. */
    environment?: string;
}
declare class OneloMonitor {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly bundleId?;
    private readonly sessionId;
    private buffer;
    private readonly summaryBuffer;
    private readonly flags;
    private readonly breadcrumbs;
    private flushTimer;
    private currentUserId;
    /** Deployment tag ("production"|"staging"|"dev"|custom) → meta.environment.
     *  Per-event meta.environment overrides. Distinct from featureEnvironment. */
    private readonly environment?;
    /** Pre-built static meta merged into every event (sdk + app). Computed once. */
    private readonly staticMeta;
    constructor(publishableKey: string, apiUrl: string, context?: MonitorContext);
    /** True when there is buffered telemetry not yet delivered (events queued, or
     *  feature-call counters awaiting their summary drain). Read by the clean-quit
     *  lifecycle flush so it only delays the quit when there's actually something
     *  to send. Package-private. */
    _hasPending(): boolean;
    /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
    setUserId(userId: string | null): void;
    _trackFeatureCall(featureName: string): void;
    /**
     * Record the current value of a feature flag for flag↔error correlation.
     * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
     * it to most-recent; capped at MAX_FLAGS. Not an event — just updates the
     * snapshot attached to future error captures.
     */
    recordFlag(key: string, value: string): void;
    track<T>(featureName: string, fn: () => Promise<T> | T, options?: {
        meta?: Record<string, unknown>;
    }): Promise<T>;
    event(featureName: string, opts: MonitorEventOptions): void;
    /**
     * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
     * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
     * message is scrubbed of secrets on the way in. Parity with Swift/JS.
     */
    breadcrumb(message: string, opts?: {
        category?: string;
        data?: Record<string, string>;
    }): void;
    /**
     * Manually capture an error/exception with its stack + the active breadcrumbs
     * and feature flags (parity with Swift/JS `capture`). Use for caught errors you
     * still want reported. Never throws.
     */
    capture(error: unknown, opts?: {
        featureName?: string;
        meta?: Record<string, unknown>;
    }): void;
    /**
     * Send the buffered events. `await flush()` already resolves only after the
     * POST settles (and `keepalive` survives a process exit), so the last batch is
     * delivered. Pass `timeoutMs` to bound the wait — for a short-lived process
     * exiting against a possibly-hung API, so shutdown can't block forever (parity
     * with Swift `flush(timeout:)` / Python `flush(timeout=)`). Never throws.
     */
    flush(timeoutMs?: number): Promise<void>;
    destroy(): Promise<void>;
    /** Fold stack/errorType into a caller's meta without mutating it. */
    private _withError;
    /** New meta with always-on SDK/app context merged in (SDK keys authoritative).
     *  A per-event meta.environment wins; else the config default fills in (parity
     *  with Swift/JS). */
    private _enrich;
    private _push;
    /**
     * Internal: routed here by the module-level crash handlers. Only the current
     * active monitor receives these. `_push` already flushes on a `global_error`.
     */
    _onGlobalError(message: string, stack?: string): void;
}

declare class OneloForms {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    submit(formSlug: string, data: Record<string, unknown>, submitterEmail?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
}

declare class OneloWaitlist {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    join(slug: string | undefined, email: string): Promise<{
        success: boolean;
        position?: number;
        alreadyJoined: boolean;
    }>;
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
declare class OneloElectronCustomerPortal {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly auth;
    private readonly protocol;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, auth: OneloElectronAuth, 
    /** Deep-link scheme (same one used for auth callbacks, e.g. "myapp") */
    protocol: string, 
    /** App bundle id — sent as X-Bundle-Id. The backend's
     *  validate_sdk_request_security REQUIRES it on live keys, so omitting it
     *  (as this module used to) makes portal-initiate 403 on production. Every
     *  sibling module (store/forms/waitlist/features) already threads it. */
    bundleId?: string);
    /**
     * Mint a portal token and return the hosted portal URL. Requires an active
     * session — the token travels in the `Authorization: Bearer` header, NEVER in
     * the URL, so it can't leak into logs / history / crash reports. Mirrors Swift
     * `initiateCustomerPortal()`. Use for a custom presentation; `open()` /
     * `openInBrowser()` wrap it.
     */
    initiate(): Promise<string>;
    /**
     * Open the Onelo hosted customer portal in a standalone in-app BrowserWindow.
     * Throws `OneloError` (`not_authenticated`) when no session is active.
     *
     * @param parentWindow  Optional parent BrowserWindow (for modal centering).
     * @returns             Resolves when the portal window is closed.
     */
    open(parentWindow?: electron.BrowserWindow): Promise<void>;
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
    openInBrowser(): Promise<void>;
    /**
     * Process a portal deep-link the OS handed to your app — only needed for the
     * `openInBrowser()` path (the embedded `open()` intercepts it itself). On a
     * hard account event (deletion / revoke / compromise) it clears the local
     * session. Returns true if the URL was a portal callback. Never throws.
     */
    handlePortalCallback(url: string): Promise<boolean>;
    /** Hard account-lifecycle events the portal can deep-link back — each clears
     *  the local session instantly (mirrors Swift's set). */
    private static readonly REVOKE_EVENTS;
    /** Clear the local session on a hard portal event: flag isUserRevoked + sign
     *  out. No-op for other/absent events. Never throws. */
    private _applyPortalEvent;
    private _presentPortalWindow;
}

/**
 * Legal-consent enforcement level. `block` gates the app until accepted;
 * `notify` is informational. Unknown future values decode to `unknown`
 * (forward-compat — never throws), mirroring Swift's `OneloConsentEnforcement`.
 */
type OneloConsentEnforcement = 'block' | 'notify' | 'unknown';
/**
 * One legal document the signed-in user has not yet accepted. Shape mirrors
 * Swift's `OneloConsentRequirement` (wire keys are snake_case; see `_mapRequirement`).
 */
interface OneloConsentRequirement {
    /** Document type: "terms" | "privacy" | "dpa" | "cookies" (open set). */
    docType: string;
    /** The version id to POST back on accept (`document_version_id`). */
    versionId: string;
    /** Human version label, e.g. "2026-06-01-v2". */
    version: string;
    /** `block` | `notify` | `unknown`. */
    enforcement: OneloConsentEnforcement;
    /** True iff this document HARD-blocks the app right now (server-computed:
     *  enforcement=block AND effective_at<=now). The single gate signal. */
    blocking: boolean;
    /** Read-only document URL (may be null for platform-scope docs). */
    url: string | null;
    /** Gate-mode URL (document + accept/decline buttons); loaded in the gate
     *  window. Null for platform-scope docs. */
    consentUrl: string | null;
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
declare class OneloConsent {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly auth;
    private readonly bundleId?;
    /** When false, the SSE handler still bumps the revision + notifies observers
     *  but does NOT auto-open the gate window (custom-UI apps drive it themselves). */
    private readonly autoPresent;
    /** Bumped on each `legal.consent_required` SSE push. Observe via
     *  `onConsentRequired` to drive your own UI (parity with Swift's
     *  @Published consentRevision). */
    private _consentRevision;
    private readonly revisionListeners;
    /** Single-owner gate claim (parity with Swift's consentGateOwner) so that when
     *  several presenters exist only ONE opens a window. */
    private _gateOwner;
    /** This instance's stable claim token. */
    private readonly gateToken;
    /** The live gate window, if one is open — prevents opening a second. */
    private _gateWindow;
    /** The live gate overlay (BrowserView filling the app window), if one is open.
     *  Preferred presentation when a parent window is registered — fits the app
     *  window, resizes with it, blocks input, non-dismissible. The standalone
     *  `_gateWindow` is only the no-parent fallback. */
    private _gateView;
    /** Main window to parent the gate on for the auto-present paths (sign-in +
     *  SSE). Registered via `setGateParent(mainWindow)`. When set, the blocking
     *  gate opens MODALLY over it — the OS blocks the app window while the gate is
     *  up, which (together with the non-dismissible close guard) is what makes the
     *  Terms gate a true block, matching Swift's `OneloAuthView` content cover.
     *  Unset → the gate still can't be dismissed, but floats non-modally so the
     *  user could alt-tab back to the app; that's why the snippet tells devs to
     *  register the window. */
    private _gateParent;
    /** Set true once the app is genuinely quitting (Cmd-Q / app.quit()) so the
     *  gate's no-dismiss close veto lets the quit through — the block must never
     *  trap the user with only force-quit left. Installed once (idempotent). */
    private _appQuitting;
    private _quitHookInstalled;
    /** Set synchronously at the top of presentGateIfNeeded and held across its
     *  `await requiredConsents()` round-trip, BEFORE `_gateWindow` is assigned —
     *  serializes concurrent callers (e.g. sign-in + a buffered SSE push on boot)
     *  so only one window opens. JS is single-threaded, so a boolean is enough. */
    private _presenting;
    constructor(apiUrl: string, publishableKey: string, auth: OneloElectronAuth, bundleId?: string, autoPresent?: boolean);
    get consentRevision(): number;
    /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
     *  unsubscribe fn. Use when you build your own consent UI instead of the
     *  auto-presented gate. */
    onConsentRequired(listener: (revision: number) => void): () => void;
    /** Claim the gate. Succeeds if free OR already yours (idempotent). Returns
     *  false if another presenter owns it → that caller must NOT show a gate. */
    claimConsentGate(id: string): boolean;
    /** Release the gate — only if `id` currently owns it (never steals). Safe to
     *  call unconditionally on teardown. */
    releaseConsentGate(id: string): void;
    /**
     * Register the app's main window so the AUTO-presented consent gate (sign-in +
     * `legal.consent_required` SSE) opens modally over it. Required for a true
     * hard block — without a parent the gate can't be dismissed but still floats
     * non-modally, so the user could keep using the app underneath. Call once after
     * you create your main window; pass `null` to clear (e.g. on window close).
     */
    setGateParent(win: electron.BrowserWindow | null): void;
    /**
     * Fetch the signed-in user's outstanding legal documents. Requires a session;
     * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
     * returns `[]` (never throws) — parity with Swift's `requiredConsents()`.
     */
    requiredConsents(): Promise<OneloConsentRequirement[]>;
    /**
     * Record acceptance of a legal document version. Requires a session. Throws
     * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
     * Mirrors Swift `acceptConsent(versionId:)`.
     */
    acceptConsent(versionId: string): Promise<void>;
    /**
     * Register the `legal.consent_required` listener on the shared stream. The
     * event is a signal only (payload ignored, like Swift) — on receipt we bump
     * the revision, notify observers, and auto-present the gate if one is warranted.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Check for an outstanding BLOCKING consent and, if present, open the hosted
     * gate. Returns true if a gate was shown. No-op when: no session, no blocking
     * document, another presenter owns the gate, or a gate window is already open.
     *
     * @param parentWindow  Pass your main window to present modally (blocks the app
     *                       until resolved — the faithful "blocking" behaviour).
     */
    presentGateIfNeeded(parentWindow?: electron.BrowserWindow): Promise<boolean>;
    /**
     * Present the gate as a BrowserView overlay that FILLS the app window and
     * resizes with it — the native equivalent of the web full-screen overlay. It
     * sits on top of the app content (blocking input) with no window chrome, so it
     * is non-dismissible: the only exits are Accept / Sign out (via the sentinel
     * nav) or a fail-open teardown if the page can't load. Requires a parent
     * window (from setGateParent or an explicit arg).
     */
    private _presentConsentOverlay;
    private _presentConsentWindow;
    /**
     * Apply the hosted page's accept/decline signal. Accept → record consent, then
     * RE-CHECK (documents stack — there may be another blocking doc). Decline (or
     * any non-accept) → sign out. Mirrors Swift `handleConsent`.
     */
    private _handleConsentAction;
}

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
declare class OneloStore {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly auth;
    private readonly bundleId?;
    private readonly protocol;
    constructor(apiUrl: string, publishableKey: string, auth: OneloElectronAuth, 
    /** Deep-link scheme for the checkout callback (same one auth uses). */
    protocol: string, bundleId?: string);
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
    initiateStoreFlow(lang?: string): Promise<string>;
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
    open(parentWindow?: electron.BrowserWindow): Promise<OneloSession | null>;
    /**
     * Open the hosted store in the user's DEFAULT SYSTEM BROWSER (via
     * `shell.openExternal`). Preferred for the payment surface — the buyer sees the
     * real domain + their saved cards / password manager. The store redirects back
     * via your deep-link scheme on completion; wire `app.on('open-url')` (macOS) /
     * `second-instance` (win/linux) to `auth.handleDeepLink(url)` to finish sign-in.
     */
    openInBrowser(lang?: string): Promise<void>;
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
    openUpgrade(plan: string, lang?: string): Promise<void>;
}

declare class Onelo {
    readonly auth: OneloElectronAuth;
    readonly features: OneloFeatures;
    readonly monitor: OneloMonitor;
    readonly feedback: OneloFeedback;
    readonly forms: OneloForms;
    readonly waitlist: OneloWaitlist;
    readonly customerPortal: OneloElectronCustomerPortal;
    /** Legal-consent gate (Terms/Privacy updates for already-signed-in users). */
    readonly consent: OneloConsent;
    /** Hosted store (checkout) + upgrade flow — the explicit monetization surface. */
    readonly store: OneloStore;
    /** Shared SSE connection (real-time `session.revoked`, `paywall.access_changed`,
     *  `legal.consent_required`, and — once features adopts it — live feature
     *  deploys). One per app. */
    private readonly eventStream;
    private readonly autoPresentConsentGate;
    constructor(config: OneloElectronConfig);
    /** Wire powerMonitor 'resume' + app 'activate' → features._resyncOnLifecycle().
     *  Registered after app 'ready' (powerMonitor requires it); guarded for
     *  non-Electron / test contexts. */
    private _registerLifecycleResync;
    /** Identify the current user (your own auth). Sets features targeting + monitor
     *  user id. Pass `userIdHash` (HMAC computed on YOUR backend) for secure mode. */
    identify(userId: string, userIdHash?: string): Promise<void>;
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
    openUpgrade(plan: string, lang?: string): Promise<void>;
    /** Drop the active identity WITHOUT a full session sign-out (identity-mode /
     *  own-auth only — Onelo Auth resets via onSessionChange). Parity with Swift
     *  Onelo.clearIdentity(). */
    clearIdentity(): Promise<void>;
    destroy(): Promise<void>;
}

declare class SecureTokenStorage {
    private storePath;
    private cache;
    constructor(storePath?: string);
    private getStorePath;
    private loadFromDisk;
    private saveToDisk;
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

export { type FeatureReason, type FeatureSnapshot, FeatureState, type FeatureStatus, IPC_CHANNELS, type MonitorContext, type MonitorEventOptions, Onelo, OneloConsent, type OneloConsentEnforcement, type OneloConsentRequirement, OneloElectronAuth, type OneloElectronConfig, OneloElectronCustomerPortal, OneloFeatures, OneloFeaturesError, type OneloFeaturesErrorCode, OneloFeedback, OneloForms, OneloMonitor, OneloStore, OneloWaitlist, SecureTokenStorage, type UpgradeHint };
