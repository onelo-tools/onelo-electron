import https from 'https'
import http from 'http'
import { sdkHeaders } from './sdk-headers'
import { getInstanceId } from './instance-id'
import { readFeatureCache, writeFeatureCache } from './feature-cache'
import type { OneloEventStream, StreamConnectionIdentity } from './event-stream'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from './user-token'

/** Error codes for OneloFeatures.moduleToken (parity with Swift OneloFeaturesError). */
export type OneloFeaturesErrorCode =
  /** No signed-in user, or their access token was refused even after a refresh. */
  | 'notAuthenticated'
  | 'notEntitled'
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'secureModeRequired'
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'invalidUserHash'
  | 'networkError'

/** Typed error thrown by `moduleToken()`. Mirrors Swift's `OneloFeaturesError` enum. */
export class OneloFeaturesError extends Error {
  constructor(public readonly code: OneloFeaturesErrorCode) {
    super(code)
    this.name = 'OneloFeaturesError'
  }
}

export type FeatureStatus =
  | 'enabled'
  | 'disabled'
  | 'greyed'
  | 'hidden'
  | 'upsell'
  | 'new'
  | 'beta'
  | 'coming_soon'

const KNOWN_STATUSES = new Set<string>([
  'enabled', 'disabled', 'greyed', 'hidden', 'upsell', 'new', 'beta', 'coming_soon',
])

// Forward-compat: a status from a NEWER backend that this SDK doesn't recognize
// must fail CLOSED to 'hidden' (mirrors Swift/JS `normalizeStatus`). Keeping the
// unknown string would render a broken affordance as VISIBLE, since
// `FeatureState.isVisible` is `status !== 'hidden'`.
function normalizeStatus(status: string): FeatureStatus {
  return (KNOWN_STATUSES.has(status) ? status : 'hidden') as FeatureStatus
}

/** Why a feature is in its state. A present-but-unknown reason from a newer
 *  backend normalizes to 'unknown' (mirrors Swift/JS) rather than dropping the
 *  feature. */
export type FeatureReason =
  | 'user_override' | 'plan' | 'default' | 'static'
  | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown'
const KNOWN_REASONS = new Set<string>([
  'user_override', 'plan', 'default', 'static', 'paywall_no_plan', 'paywall_off', 'suspended', 'unknown',
])
function normalizeReason(reason: string | undefined): FeatureReason | undefined {
  if (reason == null) return undefined
  return (KNOWN_REASONS.has(reason) ? reason : 'unknown') as FeatureReason
}

/** The backend wire shape for one feature. Forward-compatible: unknown fields
 *  are ignored; reason/plan/label/cta are optional. */
interface FeatureWire {
  status: string
  reason?: string
  required_plan?: string
  required_plan_label?: string
  upgrade_cta?: boolean
}

/** The normalized, cached shape (status already fail-closed). */
interface FeatureRecord {
  status: FeatureStatus
  reason?: FeatureReason
  requiredPlan?: string
  requiredPlanLabel?: string
  upgradeCta: boolean
}

function toRecord(w: FeatureWire): FeatureRecord {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false,
  }
}

/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 *  is available or not plan-gated. Parity with JS. */
export interface UpgradeHint {
  requiredPlan: string
  currentStatus: FeatureStatus
}

/** IPC-safe plain snapshot of a {@link FeatureState} — every computed getter
 *  (isEnabled / isVisible / badgeLabel / upgradeHint / …) materialized as an OWN
 *  data property. Electron's structured-clone IPC (`webContents.send` /
 *  `ipcMain.handle` return) copies ONLY own enumerable data props and drops the
 *  prototype + accessors, so sending a raw `FeatureState` across the boundary makes
 *  `isVisible`/`isEnabled`/`badgeLabel` arrive `undefined` in the renderer — and a
 *  `!isVisible` render guard then hides EVERY feature. Send this snapshot instead
 *  (via `feature(name).toJSON()` or `features.featureSnapshot(name)`). */
export interface FeatureSnapshot {
  name: string
  status: FeatureStatus
  reason?: FeatureReason
  requiredPlan?: string
  requiredPlanLabel?: string
  upgradeCta: boolean
  isEnabled: boolean
  isDisabled: boolean
  isVisible: boolean
  isGreyed: boolean
  isUpsell: boolean
  isNew: boolean
  isBeta: boolean
  isComingSoon: boolean
  badgeLabel: string | null
  upgradeHint: UpgradeHint | null
}

export class FeatureState {
  readonly name: string
  readonly status: FeatureStatus
  /** Why the feature is in this state (plan-gated, user override, …). */
  readonly reason?: FeatureReason
  /** Machine key of the plan that unlocks this feature — render the label. */
  readonly requiredPlan?: string
  /** Human label of the unlocking plan (e.g. "Pro"). */
  readonly requiredPlanLabel?: string
  /** The developer enabled "tap to upgrade" for this feature (backend flag). */
  readonly upgradeCta: boolean

  constructor(name: string, status: FeatureStatus, reason?: FeatureReason, requiredPlan?: string, requiredPlanLabel?: string, upgradeCta = false) {
    this.name = name
    this.status = status
    this.reason = reason
    this.requiredPlan = requiredPlan
    this.requiredPlanLabel = requiredPlanLabel
    this.upgradeCta = upgradeCta
  }

  get isEnabled(): boolean { return this.status === 'enabled' || this.status === 'new' || this.status === 'beta' }
  get isDisabled(): boolean { return this.status === 'disabled' }
  get isVisible(): boolean { return this.status !== 'hidden' }
  get isGreyed(): boolean { return this.status === 'greyed' }
  get isUpsell(): boolean { return this.status === 'upsell' }
  get isNew(): boolean { return this.status === 'new' }
  get isBeta(): boolean { return this.status === 'beta' }
  get isComingSoon(): boolean { return this.status === 'coming_soon' }

  /** Promo/lock badge (parity with Swift/JS): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel(): string | null {
    switch (this.status) {
      case 'new': return 'New'
      case 'beta': return 'Beta'
      case 'coming_soon': return 'Coming Soon'
      case 'greyed': return '🔒'
      case 'upsell':
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`
        return 'Upgrade'
      default: return null
    }
  }

  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI (parity with JS). */
  get upgradeHint(): UpgradeHint | null {
    if (
      this.reason === 'plan' &&
      this.requiredPlan &&
      (this.status === 'greyed' || this.status === 'hidden' || this.status === 'upsell' || this.status === 'coming_soon')
    ) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status }
    }
    return null
  }

  /** IPC-safe plain object — every computed getter materialized as a data property
   *  so it survives Electron structured-clone IPC (`webContents.send` /
   *  `ipcMain.handle`), which drops prototype accessors. Send THIS across IPC, not
   *  the FeatureState instance. Also used automatically by `JSON.stringify`. */
  toJSON(): FeatureSnapshot {
    return {
      name: this.name,
      status: this.status,
      reason: this.reason,
      requiredPlan: this.requiredPlan,
      requiredPlanLabel: this.requiredPlanLabel,
      upgradeCta: this.upgradeCta,
      isEnabled: this.isEnabled,
      isDisabled: this.isDisabled,
      isVisible: this.isVisible,
      isGreyed: this.isGreyed,
      isUpsell: this.isUpsell,
      isNew: this.isNew,
      isBeta: this.isBeta,
      isComingSoon: this.isComingSoon,
      badgeLabel: this.badgeLabel,
      upgradeHint: this.upgradeHint,
    }
  }
}

// ── HTTP helpers (no external deps) ─────────────────────────────────────────

function request(
  url: string,
  opts: { method: string; body?: unknown; bundleId?: string; headers?: Record<string, string> }
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    const base = sdkHeaders(opts.bundleId, opts.headers)
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method,
        headers: bodyStr
          ? { ...base, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : base,
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
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ── OneloFeatures ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000

export interface OneloFeaturesOptions {
  /** Suppress the anonymous-mode identify() warning. See OneloElectronConfig.suppressIdentifyWarning. */
  suppressIdentifyWarning?: boolean
  /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll. See OneloElectronConfig.featureEnvironment. */
  featureEnvironment?: string
  /** Status returned by feature() for a slug not (yet) in the snapshot. Fail-closed
   *  'hidden' by default; 'enabled' in dev previews new gates. 1:1 with Swift
   *  `featureDefaultStatus`. See OneloElectronConfig.featureDefaultStatus. */
  featureDefaultStatus?: FeatureStatus
  /** The signed-in Onelo user's access token, sent as `Authorization: Bearer`
   *  on every Features call (resolve, batch-ping, poll, module-token) so the
   *  server knows who the user really is. Wired by `Onelo` to `auth`. */
  userToken?: UserTokenSource
}

export class OneloFeatures {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly bundleId?: string
  private readonly featureEnvironment?: string
  private cache: Map<string, FeatureRecord> = new Map()
  private discovered: Set<string> = new Set()
  private configVersion = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pingDebounce: ReturnType<typeof setTimeout> | null = null
  private monitor: { _trackFeatureCall: (name: string) => void; recordFlag?: (key: string, value: string) => void } | null = null
  private suppressIdentifyWarning: boolean
  private anonymousWarningLogged = false
  /** Status returned by feature() for a slug not in the snapshot (default 'hidden'). */
  private readonly defaultStatus: FeatureStatus
  /** In-memory observers notified AFTER any cache change (SSE Deploy push,
   *  lifecycle resync, invalidateCache). Purely local fan-out — no network/DB/SSE.
   *  In Electron the SDK runs in the MAIN process; forward these to the renderer
   *  over IPC (main subscribe → webContents.send) so the UI re-renders on a Deploy. */
  private readonly changeListeners = new Set<() => void>()
  /** Shared SSE stream (real-time deploys). When present, it is the primary
   *  update channel; the 60s poll runs ONLY as the fallback when the stream is
   *  capped out (429 → X-Fallback: poll). */
  private stream: OneloEventStream | null = null
  private currentUserId: string | null = null
  /** Signed-in user's access token source (Bearer on every Features call). */
  private readonly userToken: UserTokenSource | null
  private userTokenRefusedWarned = false
  private streamActive = false
  /** Identity-bound readiness (#735, parity with Swift/JS). A persisted
   *  snapshot renders instantly, but only a response confirmed for THIS load
   *  generation + identity releases `ready()` or a non-zero `since_version`. */
  private firstEventReceived = false
  private loadGeneration = 0
  private identityLoaded = false
  private confirmedGeneration = -1
  private confirmedVersion = 0
  private snapshotConfirmed = false
  /** Identity the open SSE connection actually authenticated (null = none). */
  private streamConnection: StreamConnectionIdentity | null = null
  private streamConnectionGeneration = -1
  private readyWaiters = new Set<() => void>()
  /** Debounce for refresh() (parity with Swift 1s). */
  private lastRefreshAt = 0
  private static readonly REFRESH_DEBOUNCE_MS = 1000

  constructor(
    publishableKey: string,
    apiUrl: string,
    monitor?: { _trackFeatureCall: (name: string) => void; recordFlag?: (key: string, value: string) => void } | null,
    bundleId?: string,
    options?: OneloFeaturesOptions,
  ) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.monitor = monitor ?? null
    this.bundleId = bundleId
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false
    this.featureEnvironment = options?.featureEnvironment
    this.defaultStatus = options?.featureDefaultStatus ?? 'hidden'
    this.userToken = options?.userToken ?? null
  }

  /**
   * Subscribe to feature-cache changes so the host can re-render / forward to the
   * renderer the instant a fresh snapshot lands (SSE Deploy, lifecycle resync,
   * invalidateCache). Fires AFTER the cache is updated; re-read feature(name)
   * inside. Purely local (no network/DB/SSE). Returns an unsubscribe fn. In
   * Electron, wire it to `webContents.send` to push updates to the renderer UI.
   * Parity with the RN/JS `subscribe()`.
   */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  /** Notify subscribers after a cache mutation. A throwing listener never breaks
   *  cache application. */
  private _emitChange(): void {
    for (const l of [...this.changeListeners]) {
      try { l() } catch { /* a listener must never break cache application */ }
    }
  }

  /** Convenience: `true` when the feature resolves to an active status
   *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. Parity with RN. */
  isEnabled(name: string): boolean {
    return this.feature(name).isEnabled
  }

  /** IPC-safe snapshot of a feature — a plain object with every computed getter
   *  materialized as a data property. Return THIS from an `ipcMain.handle` /
   *  `webContents.send` handler in the main process; a raw `feature()` result loses
   *  its getters over structured-clone IPC and every feature would read as hidden. */
  featureSnapshot(name: string): FeatureSnapshot {
    return this.feature(name).toJSON()
  }

  feature(name: string): FeatureState {
    const isNew = !this.discovered.has(name)
    this.discovered.add(name)
    if (isNew) this._scheduleBatchPing()
    if (isNew) this.monitor?._trackFeatureCall(name)
    const rec: FeatureRecord = this.cache.get(name) ?? { status: this.defaultStatus, upgradeCta: false }
    // Feed the flag value to monitor so a captured error carries the flag context
    // that was live at crash time (flag↔error enrichment, parity with JS/Swift).
    this.monitor?.recordFlag?.(name, rec.status)
    return new FeatureState(name, rec.status, rec.reason, rec.requiredPlan, rec.requiredPlanLabel, rec.upgradeCta)
  }

  declare(names: string[]): void {
    for (const name of names) this.discovered.add(name)
    this._scheduleBatchPing()
  }

  getActiveFeatures(): string[] {
    const active: string[] = []
    for (const [name, rec] of this.cache) {
      if (new FeatureState(name, rec.status).isEnabled) active.push(name)
    }
    return active
  }

  /**
   * Mint a short-lived entitlement token for `slug` — proof the current user is
   * entitled to that feature, verifiable by your backend. Requires an identified
   * user. Parity with Swift `moduleToken(for:)`.
   *
   * @throws OneloFeaturesError — `notAuthenticated` (no user, no network; or the
   *   user's access token was refused even after a refresh), `notEntitled`
   *   (403), `networkError` (anything else, incl. the backend's current 503).
   */
  async moduleToken(slug: string): Promise<string> {
    const userId = this.currentUserId
    if (!userId) throw new OneloFeaturesError('notAuthenticated')
    let status: number
    let json: unknown
    try {
      // A module token is always for a user, so a refused token ends here
      // (`notAuthenticated`) instead of retrying anonymously.
      ({ status, json } = await sendWithUserToken(
        this.userToken,
        ({ token }) => request(`${this.apiUrl}/api/sdk/features/module-token`, {
          method: 'POST',
          body: { publishableKey: this.publishableKey, userId, slug },
          bundleId: this.bundleId,
          headers: bearerHeader(token),
        }),
        () => this._warnUserTokenRefused(),
        false,
      ))
    } catch {
      throw new OneloFeaturesError('networkError')
    }
    if (status === 200) {
      const token = (json as { token?: unknown } | null)?.token
      if (typeof token === 'string' && token.length > 0) return token
      throw new OneloFeaturesError('networkError')
    }
    if (status === 401) {
      // FastAPI serializes as {detail}; tolerate {error} too.
      const j = json as { detail?: { error?: string } | string; error?: string } | null
      const err = (typeof j?.detail === 'object' ? j?.detail?.error : undefined) ?? j?.error
      if (err === 'secure_mode_required') throw new OneloFeaturesError('secureModeRequired')
      if (err === 'invalid_user_hash') throw new OneloFeaturesError('invalidUserHash')
      throw new OneloFeaturesError('notAuthenticated')
    }
    if (status === 403) throw new OneloFeaturesError('notEntitled')
    throw new OneloFeaturesError('networkError')
  }

  /**
   * Wire the shared SSE stream (called once by Onelo, before the first _load).
   * Registers the snapshot handlers + the dynamic `since_version` param provider
   * (read fresh on every reconnect). When attached, the stream is the primary
   * update channel and polling is off — unless a 429 cap forces the poll fallback.
   */
  attachEventStream(stream: OneloEventStream): void {
    this.stream = stream
    stream.addParamProvider(() => {
      const p: Record<string, string> = {
        // Only a version confirmed for the CURRENT identity: config_version is
        // per app+environment, so a seeded/foreign version would earn an
        // `up_to_date` for a snapshot this user never received.
        since_version: String(this.snapshotConfirmed ? this.confirmedVersion : 0),
        // Per-install id — feature-discovery TOFU binding (parity with Swift/JS).
        instance_id: getInstanceId(),
      }
      if (this.featureEnvironment) p.environment = this.featureEnvironment
      return p
    })
    stream.onConnectionIdentity((identity) => {
      this.streamConnection = identity
      this.streamConnectionGeneration = identity === null ? -1 : this.loadGeneration
    })
    // A frame counts only when the open connection authenticated the current
    // identity for the current load — never an anonymous-fallback socket for a
    // signed-in user, never a socket from before the last identity change.
    const streamIsBound = (): boolean => {
      const c = this.streamConnection
      return c !== null &&
        this.streamConnectionGeneration === this.loadGeneration &&
        c.userId === this.currentUserId &&
        !c.anonymousFallback
    }
    const applyIfSnapshot = (data: Record<string, unknown>): void => {
      if (!streamIsBound()) return
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (!features) return
      const v = typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion
      this._applySnapshot(v, features, this.loadGeneration, this.currentUserId)
      this._signalFirstEvent(this.loadGeneration, this.currentUserId)
    }
    // `connected` (client behind → full snapshot) and `features_updated` (admin
    // Deploy) both carry a snapshot; `up_to_date` only advances the version.
    stream.on('connected', applyIfSnapshot)
    stream.on('features_updated', applyIfSnapshot)
    stream.on('up_to_date', (data) => {
      // Only reachable with a since_version this identity already confirmed.
      if (!streamIsBound() || typeof data['config_version'] !== 'number') return
      this.configVersion = data['config_version'] as number
      this.confirmedVersion = this.configVersion
      this._signalFirstEvent(this.loadGeneration, this.currentUserId)
    })
    // Route the dashboard "Discover Features" push through the SAME 1s debounce
    // as first-lookup + declare (a burst of discovery_requested frames, or a
    // reconnect replay, must not fire one unthrottled batch-ping each). Parity
    // with JS features.ts:302 and Swift _scheduleBatchPing.
    stream.on('discovery_requested', () => { this._scheduleBatchPing() })
    stream.onFallback(() => {
      // 429 cap → stream stopped. Poll instead so deploys still land. Kick an
      // immediate resolve first (mirrors the no-stream branch in _load) — the
      // poll interval is long, so without this the fleet would run on a stale
      // snapshot until the first tick. Fire-and-forget; the interval keeps it fresh.
      this.streamActive = false
      if (!this.identityLoaded) return
      void this._resolve(this.currentUserId, this.loadGeneration).catch(() => {})
      this._startPolling(this.currentUserId)
    })
  }

  /** @param _userIdHash Deprecated and ignored: Secure Mode is retired, and the
   *  signed-in Onelo user is proven with their access token automatically. */
  async _load(userId: string | null, _userIdHash?: string | null): Promise<void> {
    // Every load is a new generation: results requested for an earlier one
    // (a late anonymous/previous-user resolve, an old socket) are dropped, and
    // readiness + the confirmed version start over for this identity.
    const generation = ++this.loadGeneration
    this.identityLoaded = true
    this.currentUserId = userId
    this.streamConnection = null
    this.streamConnectionGeneration = -1
    this.firstEventReceived = false
    this.snapshotConfirmed = false
    this.confirmedGeneration = -1
    this.confirmedVersion = 0
    // Reload THIS identity's cache. Never keep the PREVIOUS identity's flags in
    // memory. Fail-closed: no cache for this identity → empty. A persisted
    // snapshot renders instantly but stays unconfirmed (since_version 0).
    const cached = readFeatureCache(this.publishableKey, userId)
    this.cache = cached
      ? new Map(Object.entries(cached.features).map(([k, v]) => [k, this._coerceRecord(v)]))
      : new Map()
    this.configVersion = cached ? cached.configVersion : 0
    this._emitChange()
    this._stopPolling()
    if (this.stream) {
      // Open the SSE stream FIRST (before the resolve await) so real-time
      // `session.revoked` + deploys connect immediately, not after a possibly
      // slow initial resolve. Idempotent for an unchanged userId. Mirrors JS
      // _load ordering. Poll stays off unless a 429 cap trips onFallback.
      this.streamActive = true
      this.stream.start(userId)
    }
    await this._batchPing()
    if (!this.stream) {
      // No shared stream wired (defensive) — one-shot resolve for a correct
      // initial state, then poll. When a stream IS wired we deliberately do NOT
      // resolve here: the SSE `connected` frame carries the full snapshot and
      // calls _signalFirstEvent() (so ready() still settles), and the restored
      // cache covers instant UI in the meantime — an extra /resolve on every
      // cold start / identity change / foreground is pure fleet-scale write-free
      // load. Mirrors JS load() (resolve only in the no-EventSource branch) and
      // Swift (never resolves inside _load).
      await this._resolve(userId, generation)
      if (generation === this.loadGeneration) this._startPolling(userId)
    }
  }

  private _applySnapshot(
    version: number,
    features: Record<string, FeatureWire>,
    generation: number,
    userId: string | null,
  ): void {
    // Applied (and persisted) only under the identity + generation that asked.
    if (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId) return
    this.confirmedVersion = version
    this.snapshotConfirmed = true
    this.cache = new Map(Object.entries(features).map(([k, v]) => [k, toRecord(v)]))
    this.configVersion = version
    // Persist so the next cold start renders instantly (parity with Swift/JS).
    writeFeatureCache(this.publishableKey, this.currentUserId, {
      configVersion: version,
      features: Object.fromEntries(this.cache),
    })
    this._emitChange()
  }

  /** Coerce a persisted cache value back to a FeatureRecord, re-normalizing the
   *  status defensively (a value persisted by an older/newer SDK). */
  private _coerceRecord(v: unknown): FeatureRecord {
    const r = (v ?? {}) as Partial<FeatureRecord>
    return {
      status: normalizeStatus(String(r.status ?? 'hidden')),
      reason: normalizeReason(r.reason as string | undefined),
      requiredPlan: r.requiredPlan,
      requiredPlanLabel: r.requiredPlanLabel,
      upgradeCta: r.upgradeCta ?? false,
    }
  }

  /** Resolve all pending `ready()` waiters once the first event lands. Idempotent. */
  private _signalFirstEvent(generation: number, userId: string | null): void {
    if (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId) return
    if (this.firstEventReceived && this.confirmedGeneration === generation) return
    this.firstEventReceived = true
    this.snapshotConfirmed = true
    this.confirmedGeneration = generation
    for (const resolve of this.readyWaiters) resolve()
    this.readyWaiters.clear()
  }

  /**
   * Await the first feature snapshot/handshake so the app can render
   * feature-dependent UI without a cold-start flicker — but never block longer
   * than `timeoutMs` (default 1500). Resolves immediately if already ready.
   * Parity with Swift `ready(timeout:)`.
   */
  async ready(timeoutMs = 1500): Promise<void> {
    if (this.firstEventReceived && this.confirmedGeneration === this.loadGeneration) return
    await new Promise<void>((resolve) => {
      let done = false
      const settle = (): void => { if (!done) { done = true; this.readyWaiters.delete(settle); resolve() } }
      this.readyWaiters.add(settle)
      const t = setTimeout(settle, timeoutMs)
      t.unref?.()
    })
  }

  /** A comparable picture of the current snapshot — the plan-change refresher
   *  (#659) re-checks until it differs. @internal */
  snapshotKey(): string {
    return JSON.stringify([...this.cache.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }

  /**
   * Manually re-resolve features from the backend (e.g. after a checkout or on
   * app resume). Debounced to 1s unless `force` is true. Never throws. Parity
   * with Swift `refresh(force:)`.
   */
  async refresh(force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastRefreshAt < OneloFeatures.REFRESH_DEBOUNCE_MS) return
    this.lastRefreshAt = now
    await this._resolve(this.currentUserId, this.loadGeneration)
  }

  /**
   * Re-sync on app lifecycle (resume from sleep / window re-activate). Under OS
   * suspension the SSE socket + the silence watchdog are both frozen, so the
   * system wake event is the only reliable heal trigger. Reconnects the stream
   * and force-refreshes over REST. Parity with Swift `_resyncOnLifecycle`.
   */
  _resyncOnLifecycle(): void {
    if (this.streamActive) this.stream?.reconnect()
    void this.refresh(true)
  }

  /** Stop background polling. Call when the SDK is no longer needed. */
  stopPolling(): void {
    this._stopPolling()
  }

  /** Clears the local feature cache and resets the config version. Forces the
   *  stream to resend a full snapshot (since_version=0) — a live connection stays
   *  silent otherwise. */
  invalidateCache(): void {
    this.cache = new Map()
    this.configVersion = 0
    this.confirmedVersion = 0
    this.snapshotConfirmed = false
    this.firstEventReceived = false
    this.confirmedGeneration = -1
    if (this.streamActive) this.stream?.reconnect()
    this._emitChange()
  }

  _stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.pingDebounce) { clearTimeout(this.pingDebounce); this.pingDebounce = null }
  }

  private _scheduleBatchPing(): void {
    if (this.pingDebounce) clearTimeout(this.pingDebounce)
    this.pingDebounce = setTimeout(() => { this._batchPing().catch(() => {}) }, 1000)
  }

  private async _batchPing(): Promise<void> {
    const features = Array.from(this.discovered)
    if (features.length === 0) return
    // 1% sampling in LIVE env — a live batch-ping only bumps last_seen_at, so a
    // per-process 1% coin flip gives enough staleness resolution without fleet
    // write amplification. Test env always pings (reliable discovery). Parity
    // with Swift `_shouldBatchPingOnLoad` / JS `_batchPing`.
    const isTestEnv = this.featureEnvironment === 'test' || this.publishableKey.includes('_test_')
    if (!isTestEnv && Math.random() > 0.01) return
    const userId = this.currentUserId
    try {
      await sendWithUserToken(this.userToken, ({ token, anonymous }) => request(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        method: 'POST',
        body: {
          publishableKey: this.publishableKey,
          features,
          // Per-user signal (camelCase `userId` — matches the backend
          // BatchPingRequest model + Swift/JS). Omitted (not null) when anonymous.
          ...(userId && !anonymous ? { userId } : {}),
          ...(this.featureEnvironment ? { environment: this.featureEnvironment } : {}),
        },
        bundleId: this.bundleId,
        headers: bearerHeader(token),
      }), () => this._warnUserTokenRefused(), true, false)
    } catch {
      // best-effort
    }
  }

  private async _resolve(userId: string | null, generation: number): Promise<void> {
    // Before the first identity load (session restore pending) there is no
    // identity to resolve for — an anonymous answer here would race the restore.
    if (!this.identityLoaded) return
    try {
      const { status, json } = await sendWithUserToken(this.userToken, ({ token, anonymous }) => {
        const body: Record<string, unknown> = { publishableKey: this.publishableKey }
        // `userId` rides along with the token: the server ignores it when the
        // token is valid, and a server without #517 still resolves by it.
        if (userId && !anonymous) body.userId = userId
        if (this.featureEnvironment) body.environment = this.featureEnvironment
        return request(`${this.apiUrl}/api/sdk/features/resolve`, {
          method: 'POST', body, bundleId: this.bundleId, headers: bearerHeader(token),
        })
      }, () => this._warnUserTokenRefused(), userId === null) // never fall back anonymous for a user
      if (status !== 200) return
      // Stale: the identity changed while this was in flight.
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return
      const data = json as Record<string, unknown>
      // An anonymous answer never replaces a signed-in user's snapshot.
      if (userId !== null && data['anonymous'] === true) return
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (!features) return
      this._applySnapshot(typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion, features, generation, userId)
      this._maybeWarnAnonymous(data)
      // A successful resolve is also a confirmation — so ready() resolves even
      // when the SSE never handshakes (e.g. 429 poll-fallback path).
      this._signalFirstEvent(generation, userId)
    } catch {
      // keep existing cache
    }
  }

  /** The server refused the signed-in user's access token even after a refresh,
   *  so the call went out anonymous. Features has no error callback; this
   *  one-time warning is its error channel (like the anonymous-mode warning). */
  private _warnUserTokenRefused(): void {
    if (this.userTokenRefusedWarned) return
    this.userTokenRefusedWarned = true
    // eslint-disable-next-line no-console
    console.warn(
      '[Onelo] The signed-in user\'s access token was refused by Features (invalid_user_token) ' +
      'even after a refresh, so the request was made without a user. ' +
      'Check that the publishableKey belongs to the app the user signed in to.',
    )
  }

  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   */
  private _maybeWarnAnonymous(response: Record<string, unknown>): void {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return
    if (response['anonymous'] !== true) return
    const misses = typeof response['targeting_misses'] === 'number' ? (response['targeting_misses'] as number) : 0
    if (misses <= 0) return
    this.anonymousWarningLogged = true
    // eslint-disable-next-line no-console
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.\n` +
      `If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.\n` +
      `If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloElectronConfig to silence this.`
    )
  }

  private async _poll(userId: string | null, generation = this.loadGeneration): Promise<void> {
    if (!this.identityLoaded) return
    try {
      // The key is NOT here — it travels as the `X-Publishable-Key` request
      // header (ADR-0003, #105), exactly as event-stream.ts sends it on the
      // stream. /poll fires on a timer, so a raw key in the URL landed in the
      // reverse proxy's access.log on every tick; from 2027-03-31 the backend
      // refuses `?key=` outright.
      const params = new URLSearchParams({
        // Backend /poll expects `since_version` (its up_to_date short-circuit
        // keys off it) — NOT `version`, which it ignores.
        since_version: String(this.snapshotConfirmed ? this.confirmedVersion : 0),
      })
      if (this.featureEnvironment) params.set('environment', this.featureEnvironment)
      const { status, json } = await sendWithUserToken(this.userToken, ({ token, anonymous }) => {
        const query = new URLSearchParams(params)
        if (userId && !anonymous) query.set('userId', userId)
        return request(
          `${this.apiUrl}/api/sdk/features/poll?${query}`,
          {
            method: 'GET',
            bundleId: this.bundleId,
            headers: { 'X-Publishable-Key': this.publishableKey, ...bearerHeader(token) },
          },
        )
      }, () => this._warnUserTokenRefused(), userId === null)
      if (status !== 200) return
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return
      const data = json as Record<string, unknown>
      if (userId !== null && data['anonymous'] === true) return
      // Backend /poll returns `up_to_date: true` (version match) OR a snapshot.
      if (data['up_to_date'] === true) return
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (features) {
        this._applySnapshot(typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion, features, generation, userId)
        this._signalFirstEvent(generation, userId)
      }
      if (data['discovery_requested'] === true) {
        await this._batchPing()
      }
    } catch {
      // ignore — retry on next poll
    }
  }

  private _startPolling(userId: string | null): void {
    // Clear any existing timer first — onFallback can fire more than once (each
    // 429 cap) and _load also starts polling; without this a second setInterval
    // would leak and double the poll rate.
    this._stopPolling()
    const generation = this.loadGeneration
    this.pollTimer = setInterval(() => { this._poll(userId, generation).catch(() => {}) }, POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }
}
