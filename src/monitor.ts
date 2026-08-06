import os from 'os'
import { scrubText, scrubMeta } from './scrubber'
import { version as SDK_VERSION } from '../package.json'

export interface MonitorEventOptions {
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

type EventSource = 'feature_call_summary' | 'track' | 'event' | 'global_error'

interface Breadcrumb { category: string; message: string; ts: number; data?: Record<string, string> }

interface BufferedEvent {
  /**
   * ISO-8601 UTC, stamped when the event HAPPENED — not when it is sent.
   *
   * The backend clamps this to a 1h staleness window and falls back to ingest
   * time when it is absent (`_resolve_event_ts` in sdk_monitor.py), so without
   * it a batch that waited out an outage is recorded as having happened the
   * moment the outage ended. Parity with onelo-python / node / php, which have
   * always sent it.
   */
  ts: string
  featureName: string
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
  source: EventSource
  userId?: string
  platform: string
  sessionId: string
}

/** Host-app context for Monitor events (parity with Swift MonitorAppContext + JS MonitorContext). */
export interface MonitorContext {
  /** App bundle id → meta.app.bundleId + X-Bundle-Id header. */
  bundleId?: string
  /** Host app version (e.g. app.getVersion()) → meta.app.version. */
  appVersion?: string
  /** Host app build number → meta.app.build. */
  appBuild?: string
  /** Deployment tag ("production"|"staging"|"dev") → meta.environment. */
  environment?: string
}

const MAX_BUFFER_SIZE = 200
const MAX_FLAGS = 100        // LRU cap on the flag snapshot (parity with Swift/JS)
const MAX_BREADCRUMBS = 100  // ring-buffer cap for the error trail
const PLATFORM = 'electron'
const SDK_NAME = '@onelo/electron'
// Delivery policy: ONE attempt per flush. A batch the server did not accept goes
// back in the buffer and rides the next 15s tick — the timer IS the retry, so a
// backend outage never multiplies inbound request volume (an in-flight retry
// loop would have tripled it at the worst possible moment) and a drain always
// stays milliseconds long, which is what keeps every teardown path bounded.
const MAX_RETRY_AFTER_MS = 3_600_000
/** Upper bound on a normal (non-quit) send, so a hung API can never wedge the
 *  serialised flush chain past the next tick. The quit path passes its own,
 *  tighter deadline. */
const DEFAULT_SEND_TIMEOUT_MS = 10_000

/**
 * What one delivery attempt means for the batch:
 * `done`    — the server ACCEPTED it. Settled; never send again.
 * `requeue` — the server did NOT take it (429, 5xx, network). Put it back and
 *             let the next flush carry it.
 * `drop`    — permanently rejected (4xx other than 429: bad key, malformed
 *             payload). Re-sending would fail identically forever, so we discard
 *             it — but LOUDLY, never silently.
 */
type SendOutcome = 'done' | 'requeue' | 'drop'

// eslint-disable-next-line no-console
const _warn = (...args: unknown[]): void => console.warn('[onelo.monitor]', ...args)

/** Seconds-form `Retry-After` → ms, clamped. Tolerates a header-less response
 *  (test doubles) — never throws. */
function _parseRetryAfter(res: Response): number {
  let raw: string | null = null
  try {
    raw = res.headers?.get?.('Retry-After') ?? null
  } catch { /* no headers — treat as absent */ }
  if (!raw) return 0
  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds)) return 0
  return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS))
}

/** Normalize any thrown value into { message, stack, errorType }. */
function _extractError(err: unknown): { message: string; stack?: string; errorType?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name }
  return { message: String(err) }
}

/** Best-effort Node/Electron device context (parity with Swift/JS meta.device). */
function _deviceContext(): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  try {
    d['platform'] = process.platform
    d['osRelease'] = os.release()
    d['arch'] = process.arch
    d['nodeVersion'] = process.version
  } catch { /* omit */ }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) d['timezone'] = tz
  } catch { /* Intl unavailable — omit */ }
  return d
}

// Global crash handlers are installed ONCE at module scope and route to the
// CURRENT live monitor (latest-wins, mirroring Swift/JS). This fixes the
// dual-instance bug: a SECOND OneloMonitor (two Onelo instances, HMR, tests)
// becomes the active target instead of being silently ignored by a stuck
// one-shot flag, and after destroy() no crash routes into a dead instance.
let _activeMonitor: OneloMonitor | null = null
let _handlersInstalled = false
let _lifecycleInstalled = false

/**
 * Deliver the final buffered batch on a CLEAN app quit. Without this an Electron
 * app that quits normally (Cmd-Q / app.quit()) loses up to 15s of buffered
 * success/track events — the 15s flush timer is `.unref()`'d so it never keeps
 * the process alive, and there was no quit hook. JS auto-delivers on
 * `beforeunload`/`pagehide`; Swift flushes in `deinit`. A clean quit is NOT a
 * crash — here we CAN briefly delay it: preventDefault once, run a bounded flush,
 * then re-quit (the `flushed` latch lets the second before-quit through).
 * Installed ONCE at module scope; always flushes the CURRENT live monitor
 * (latest-wins, mirroring the crash handler). No-op outside Electron (tests).
 */
function _installLifecycleFlush(): void {
  if (_lifecycleInstalled) return
  let app: typeof import('electron').app | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = (require('electron') as typeof import('electron')).app
  } catch { return } // non-Electron / test — no app lifecycle to hook
  if (!app || typeof app.on !== 'function') return
  _lifecycleInstalled = true
  let flushed = false
  app.on('before-quit', (event: { preventDefault: () => void }) => {
    const m = _activeMonitor
    if (flushed || !m || !m._hasPending()) return // nothing to send → let it quit
    flushed = true
    event.preventDefault()
    // Bounded (2s) so a hung network never blocks the quit; keepalive lets the
    // POST survive the exit if it doesn't finish in time.
    void m.flush(2000).finally(() => app!.quit())
  })
}

function _installGlobalHandlers(): void {
  if (_handlersInstalled) return
  const proc = (globalThis as { process?: { on?: (e: string, fn: (v: unknown) => void) => void } }).process
  if (!proc || typeof proc.on !== 'function') return
  _handlersInstalled = true
  // `uncaughtExceptionMonitor` OBSERVES the fatal error WITHOUT suppressing
  // Node/Electron's default crash-and-exit — a plain `uncaughtException` listener
  // (which the previous version used) leaves the host running in a corrupt
  // state. We deliberately do NOT register `unhandledRejection`: any listener
  // there overrides the host's termination policy, which a monitoring SDK must
  // never silently change.
  proc.on('uncaughtExceptionMonitor', (err: unknown) => {
    const { message, stack } = _extractError(err)
    _activeMonitor?._onGlobalError(message, stack)
  })
}

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly bundleId?: string
  private readonly sessionId: string = crypto.randomUUID()
  private buffer: BufferedEvent[] = []
  // Aggregated feature-call counters (name→count). Kept SEPARATE from the capped
  // event buffer so a burst of feature discoveries never evicts real errors;
  // drained into one `feature_call_summary` event per feature at flush. Mirrors
  // Swift's summaryBuffer (OneloMonitor.swift).
  private readonly summaryBuffer = new Map<string, number>()
  // Rolling LRU snapshot of the most recently evaluated feature flags
  // (name→status), attached to ERROR events (flag↔error correlation).
  private readonly flags = new Map<string, string>()
  // Ring buffer of breadcrumbs (the trail leading to an error), snapshotted into
  // meta.breadcrumbs on error events.
  private readonly breadcrumbs: Breadcrumb[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUserId: string | null = null
  /** Serialises all drains so a timer flush and an error flush can't overlap. */
  private flushChain: Promise<void> = Promise.resolve()
  /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
  private retryAfterUntil = 0
  /** Deployment tag ("production"|"staging"|"dev"|custom) → meta.environment.
   *  Per-event meta.environment overrides. Distinct from featureEnvironment. */
  private readonly environment?: string
  /** Pre-built static meta merged into every event (sdk + app). Computed once. */
  private readonly staticMeta: Record<string, unknown>

  constructor(publishableKey: string, apiUrl: string, context?: MonitorContext) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.bundleId = context?.bundleId
    this.environment = context?.environment
    const app: Record<string, string> = {}
    if (context?.appVersion) app.version = context.appVersion
    if (context?.appBuild) app.build = context.appBuild
    if (context?.bundleId) app.bundleId = context.bundleId
    this.staticMeta = {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      ...(Object.keys(app).length ? { app } : {}),
    }
    this.flushTimer = setInterval(() => { void this.flush() }, 15000)
    this.flushTimer.unref?.()
    // Latest-wins: become the active target for global crashes + install once.
    _activeMonitor = this
    _installGlobalHandlers()
    _installLifecycleFlush()
    // Auto-emit one unconditional event per construction. A host app that gates
    // every instrumented operation behind sign-in/paywall/consent would
    // otherwise emit NOTHING on a cold start — the dashboard would look
    // "not integrated" even though every line of the snippet was followed
    // correctly. This event needs no gate to exist: it fires the moment the
    // SDK is constructed, so Feature Health always has at least one row.
    this._push('session_opened', true, undefined, undefined, undefined, 'event')
  }

  /** True when there is buffered telemetry not yet delivered (events queued, or
   *  feature-call counters awaiting their summary drain). Read by the clean-quit
   *  lifecycle flush so it only delays the quit when there's actually something
   *  to send. Package-private. */
  _hasPending(): boolean {
    return this.buffer.length > 0 || this.summaryBuffer.size > 0
  }

  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId: string | null): void {
    this.currentUserId = userId
  }

  _trackFeatureCall(featureName: string): void {
    // Increment the aggregate counter instead of pushing a full event. On a busy
    // app this avoids filling the capped event buffer (and evicting errors) with
    // identical ok=true feature-call events. Drained at flush() into a single
    // `feature_call_summary` event with meta.calls=N — the source the backend
    // roll-up recognises (sdk_monitor.py). Parity with Swift's summaryBuffer.
    this.summaryBuffer.set(featureName, (this.summaryBuffer.get(featureName) ?? 0) + 1)
  }

  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
   * it to most-recent; capped at MAX_FLAGS. Not an event — just updates the
   * snapshot attached to future error captures.
   */
  recordFlag(key: string, value: string): void {
    if (this.flags.has(key)) this.flags.delete(key) // move-to-end (LRU)
    this.flags.set(key, value)
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value
      if (oldest !== undefined) this.flags.delete(oldest)
    }
  }

  async track<T>(featureName: string, fn: () => Promise<T> | T, options?: { meta?: Record<string, unknown> }): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, options?.meta, 'track')
      return result
    } catch (err) {
      const { message, stack, errorType } = _extractError(err)
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), 'track')
      throw err
    }
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, 'event')
  }

  /**
   * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
   * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
   * message is scrubbed of secrets on the way in. Parity with Swift/JS.
   */
  breadcrumb(message: string, opts?: { category?: string; data?: Record<string, string> }): void {
    this.breadcrumbs.push({
      category: opts?.category ?? 'info',
      message: scrubText(message),
      ts: Date.now(),
      ...(opts?.data ? { data: opts.data } : {}),
    })
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift()
  }

  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift/JS `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error: unknown, opts?: { featureName?: string; meta?: Record<string, unknown> }): void {
    const { message, stack, errorType } = _extractError(error)
    this._push(opts?.featureName ?? 'captured', false, undefined, message, this._withError(opts?.meta, stack, errorType), 'event')
  }

  /**
   * Send the buffered events. `await flush()` already resolves only after the
   * POST settles (and `keepalive` survives a process exit), so the last batch is
   * delivered. Pass `timeoutMs` to bound the wait — for a short-lived process
   * exiting against a possibly-hung API, so shutdown can't block forever (parity
   * with Swift `flush(timeout:)` / Python `flush(timeout=)`). Never throws.
   *
   * Drains are SERIALISED through one promise chain: the 15s timer, an error
   * auto-flush and the quit flush must never drain concurrently, because two
   * overlapping drains would interleave batches (and the second would see an
   * empty buffer and report "sent").
   */
  async flush(timeoutMs?: number): Promise<void> {
    this.flushChain = this.flushChain.then(() => this._drain(timeoutMs)).catch(() => {})
    return this.flushChain
  }

  private async _drain(timeoutMs?: number): Promise<void> {
    // Materialise aggregated feature-call counters into one summary event each
    // (source 'feature_call_summary', meta.calls=N) — kept out of the buffer
    // between flushes so they never evict errors. After draining, counters reset;
    // the next window starts fresh. Mirrors Swift's flush() summary drain.
    for (const [featureName, calls] of this.summaryBuffer) {
      if (calls <= 0) continue
      this.buffer.push({
        // Stamped as the summary event is materialised — the close of the
        // aggregation window it describes. Same reason as _push: without it a
        // batch delayed by an outage lands under the recovery's timestamp.
        ts: new Date().toISOString(),
        featureName,
        ok: true,
        meta: this._enrich({ calls }),
        source: 'feature_call_summary',
        userId: this.currentUserId ?? undefined,
        platform: PLATFORM,
        sessionId: this.sessionId,
      })
    }
    this.summaryBuffer.clear()
    if (this.buffer.length === 0) return
    // Server told us to back off (429/Retry-After) — leave events buffered. The
    // quit path (timeoutMs set) ignores the hold-off: a best-effort final send
    // beats silently discarding the tail, since there is no next flush.
    if (timeoutMs == null && Date.now() < this.retryAfterUntil) return
    const events = this.buffer.splice(0)
    const body = JSON.stringify({ publishableKey: this.publishableKey, events })
    // ONE attempt. Anything the server did not accept goes straight back in the
    // buffer and rides the next 15s tick — the flush timer IS the retry.
    // With a single attempt the quit deadline only has to bound ONE request; the
    // normal path gets DEFAULT_SEND_TIMEOUT_MS so a hung fetch can't be awaited
    // forever either.
    if (await this._sendOnce(body, timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS) === 'requeue') this._requeue(events)
  }

  /**
   * One POST. Never throws — classifies the result instead. When `timeoutMs` is
   * set the attempt is bounded two ways: we abort the request AND race it
   * against a timer. The race is what actually guarantees the bound — an
   * `AbortController` only helps if the fetch implementation honours the signal,
   * and if it doesn't, `await fetch(...)` would hang and block the quit forever.
   * The abort is still issued so the aborted request can't dangle and hold the
   * event loop open past exit.
   */
  private async _sendOnce(body: string, timeoutMs?: number): Promise<SendOutcome> {
    const controller = new AbortController()
    const attempt = (async (): Promise<SendOutcome | undefined> => {
      try {
        const { sdkHeaders } = await import('./sdk-headers')
        return this._classify(await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
          method: 'POST',
          headers: { ...sdkHeaders(this.bundleId), 'Content-Type': 'application/json' },
          body,
          keepalive: true, // best-effort survival if the process is exiting
          signal: controller.signal,
        }))
      } catch {
        return 'requeue' // network error / AbortError — the batch never landed
      }
    })()
    if (timeoutMs == null) return (await attempt) ?? 'requeue'
    let t: ReturnType<typeof setTimeout> | undefined
    const timer = new Promise<undefined>((resolve) => {
      t = setTimeout(() => { controller.abort(); resolve(undefined) }, timeoutMs)
      t.unref?.()
    })
    try {
      return (await Promise.race([attempt, timer])) ?? 'requeue'
    } finally {
      if (t) clearTimeout(t)
    }
  }

  /** Map an HTTP response to a delivery outcome. */
  private _classify(res: Response): SendOutcome {
    // `fetch` does NOT reject on an HTTP error status, so this classification is
    // the only thing standing between a 503 and a silently lost batch.
    const status = res?.status ?? 0
    if (status >= 200 && status < 300) return 'done'
    if (status === 429) {
      const waitMs = _parseRetryAfter(res)
      if (waitMs > 0) this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + waitMs)
      // Rate limited: the server did NOT accept these events. Re-queue them; the
      // hold-off above stops the next flushes until the window reopens.
      return 'requeue'
    }
    if (status >= 400 && status < 500) {
      // 401 bad key, 403 forbidden, 422 malformed — identical every time, so
      // re-queueing would wedge the buffer forever. Drop, but say so.
      _warn(`batch rejected with HTTP ${status} — dropping it (retrying would fail identically)`)
      return 'drop'
    }
    return 'requeue' // 5xx (and anything unrecognised) — server-side; try next flush
  }

  /**
   * Put an undelivered batch back at the FRONT of the buffer so the next flush
   * retries it, then re-apply the cap.
   *
   * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
   * trimmed from the front, so the oldest re-queued events go first. This matches
   * `_push`'s newest-wins eviction, keeps memory bounded at MAX_BUFFER_SIZE no
   * matter how long the backend is down, and stops a wedged batch from starving
   * live telemetry. Drops are reported, never silent.
   */
  private _requeue(events: BufferedEvent[]): void {
    this.buffer.unshift(...events)
    let dropped = 0
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
      dropped++
    }
    _warn(
      `delivery failed — ${events.length} event(s) re-queued` +
        (dropped > 0 ? `, ${dropped} oldest dropped (buffer cap ${MAX_BUFFER_SIZE})` : ''),
    )
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Stop routing global crashes into this (now-dead) instance.
    if (_activeMonitor === this) _activeMonitor = null
    await this.flush()
  }

  /** Fold stack/errorType into a caller's meta without mutating it. */
  private _withError(meta: Record<string, unknown> | undefined, stack?: string, errorType?: string): Record<string, unknown> {
    return {
      ...(meta ?? {}),
      ...(stack ? { stack } : {}),
      ...(errorType ? { errorType } : {}),
    }
  }

  /** New meta with always-on SDK/app context merged in (SDK keys authoritative).
   *  A per-event meta.environment wins; else the config default fills in (parity
   *  with Swift/JS). */
  private _enrich(meta?: Record<string, unknown>): Record<string, unknown> {
    const out = { ...(meta ?? {}), ...this.staticMeta }
    if (this.environment != null && out['environment'] == null) out['environment'] = this.environment
    return out
  }

  private _push(
    featureName: string,
    ok: boolean,
    durationMs?: number,
    error?: string,
    meta?: Record<string, unknown>,
    source: EventSource = 'event',
  ): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift()
    const isError = !ok || source === 'global_error'
    // On an ERROR attach device context + the breadcrumb trail BEFORE scrubbing
    // (their string values are free text that may contain secrets).
    const enriched = this._enrich(meta)
    if (isError) {
      const device = _deviceContext()
      if (Object.keys(device).length > 0) enriched['device'] = device
      if (this.breadcrumbs.length > 0) enriched['breadcrumbs'] = this.breadcrumbs.slice()
    }
    const scrubbed = scrubMeta(enriched)
    // Flags folded in AFTER scrubbing: keys are feature NAMES + values are
    // statuses (never secrets), so scrubbing them would only risk a
    // false-positive redaction of a flag whose name resembles a PII key.
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed['flags'] = Object.fromEntries(this.flags)
    }
    this.buffer.push({
      ts: new Date().toISOString(),
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? undefined,
      platform: PLATFORM,
      sessionId: this.sessionId,
    })
    if (isError) void this.flush()
  }

  /**
   * Internal: routed here by the module-level crash handlers. Only the current
   * active monitor receives these. `_push` already flushes on a `global_error`.
   */
  _onGlobalError(message: string, stack?: string): void {
    this._push('unhandled', false, undefined, message, this._withError(undefined, stack), 'global_error')
  }
}
