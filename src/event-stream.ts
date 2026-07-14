/**
 * OneloEventStream (Electron / Node main process).
 *
 * One persistent SSE connection to `GET /api/sdk/features/stream`, multiplexed
 * for every module (auth `session.revoked`, features `features_updated`, …).
 * Mirrors the Swift `OneloEventStream` and the `onelo-js` one: a single
 * connection per app, a name→handlers registry, bounded-backoff reconnection.
 *
 * WHY this is hand-rolled (unlike onelo-js which uses the browser `EventSource`):
 * the Electron SDK runs in the MAIN process (Node), which has no `EventSource`,
 * no `document`, no `window`. So — exactly like the Swift SDK — we consume the
 * `text/event-stream` body over a streaming `fetch` and parse SSE frames by
 * hand. Because we CAN see the server's `:keepalive` comments (the browser
 * `EventSource` hides them), we use a Swift-style SILENCE WATCHDOG: any byte
 * (named event OR keepalive) resets it; if it fires, the connection is dead and
 * we reconnect. That is more robust than the browser's readyState signal.
 *
 * The endpoint authenticates via the `key` query param (publishable key) — no
 * Authorization header — so it is a plain GET.
 *
 * Lifecycle is owned by the composition root (`Onelo`), not any single consumer:
 * consumers only `on()` / `addParamProvider()`; `Onelo` calls
 * `start()/stop()/destroy()`.
 */
import { sdkHeaders } from './sdk-headers'

export type SseHandler = (data: Record<string, unknown>) => void
type ParamProvider = () => Record<string, string>

// Bounded backoff — near-instant recovery for a network blip, no tight loop on a
// hard failure. Same schedule as onelo-js / Swift.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
// The server sends `:keepalive` comments well inside this window; no byte at all
// for this long means the connection is dead (proxy killed it silently). Swift
// uses the same watchdog approach.
const SILENCE_TIMEOUT_MS = 45_000
// Cap the reassembly buffer — a server/proxy that never emits a frame terminator
// must not grow it without bound. 1 MiB is far above any real SSE frame.
const MAX_BUFFER_BYTES = 1 << 20

export class OneloEventStream {
  private controller: AbortController | null = null
  private readonly handlers = new Map<string, SseHandler[]>()
  private readonly paramProviders: ParamProvider[] = []
  private userId: string | null = null
  private started = false
  private destroyed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  /** Fired when the server caps the connection (429, X-Fallback: poll) and the
   *  stream stops — a consumer (features) can start polling instead. */
  private onFallbackCb: (() => void) | null = null
  // Monotonic connection id: a read loop only acts if it is still the current
  // connection (guards against a stale loop resurrecting after stop/reconnect).
  private connEpoch = 0

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly sdkVersion?: string,
    private readonly bundleId?: string,
  ) {}

  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
   * in a module constructor) so no event is missed between connect and sign-in.
   */
  on(event: string, handler: SseHandler): void {
    const arr = this.handlers.get(event) ?? []
    arr.push(handler)
    this.handlers.set(event, arr)
  }

  /**
   * Extra query params, read fresh on EVERY (re)connect — for values that change
   * over the connection's life (e.g. features' `since_version`), so a reconnect
   * always sends the current value.
   */
  addParamProvider(fn: ParamProvider): void {
    this.paramProviders.push(fn)
  }

  /** Register a callback fired when a 429 connection-cap stops the stream, so a
   *  consumer can fall back to polling (honours the backend's X-Fallback: poll). */
  onFallback(cb: () => void): void {
    this.onFallbackCb = cb
  }

  /**
   * Open (or re-open) the connection for a user. Idempotent: a repeat call with
   * the same userId while already connected is a no-op. A changed userId
   * reconnects so per-user routing (features + `session.revoked` targeting) is
   * correct.
   */
  start(userId: string | null): void {
    if (this.destroyed) return
    const changed = userId !== this.userId || !this.started
    this.userId = userId
    this.started = true
    if (changed) void this._connect()
  }

  /** Close the connection and cancel any pending reconnect. */
  stop(): void {
    this.started = false
    this._clearReconnect()
    this._clearSilence()
    this._abort()
  }

  /** Permanent teardown — cannot be restarted. */
  destroy(): void {
    this.destroyed = true
    this.stop()
  }

  /**
   * Force a fresh connection NOW, re-reading all params. Used after a consumer
   * resets a provider value (e.g. features' `invalidateCache()` → `since_version
   * = 0`, so only a reconnect makes the server resend a full snapshot). No-op
   * when not started or destroyed.
   */
  reconnect(): void {
    if (this.destroyed || !this.started) return
    void this._connect()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private _buildUrl(): string {
    const params = new URLSearchParams({ key: this.publishableKey, sdk_platform: 'electron' })
    if (this.sdkVersion) params.set('sdk_version', this.sdkVersion)
    if (this.userId) params.set('userId', this.userId)
    for (const provide of this.paramProviders) {
      for (const [k, v] of Object.entries(provide())) params.set(k, v)
    }
    return `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`
  }

  private async _connect(): Promise<void> {
    if (this.destroyed || !this.started) return
    // A fresh connection supersedes any pending backoff timer and any prior
    // read loop.
    this._clearReconnect()
    this._abort()
    const epoch = ++this.connEpoch
    const controller = new AbortController()
    this.controller = controller

    let res: Response
    try {
      res = await fetch(this._buildUrl(), {
        method: 'GET',
        // sdkHeaders adds X-Bundle-Id (+ X-SDK-Version / X-Onelo-Instance-Id) — the
        // backend security gate 403s a live app with a registered bundle on
        // /features/stream without X-Bundle-Id → the stream would reconnect-loop
        // forever and realtime (features_updated / session.revoked) would be dead.
        headers: { Accept: 'text/event-stream', ...sdkHeaders(this.bundleId) },
        signal: controller.signal,
      })
    } catch {
      // Network error before headers — transient; back off (unless superseded).
      if (epoch === this.connEpoch && this.started && !this.destroyed) this._scheduleReconnect()
      return
    }

    if (epoch !== this.connEpoch) return // superseded while awaiting headers

    if (res.status === 429) {
      // SSE connection cap reached (X-Fallback: poll). Do NOT hammer — stop the
      // stream and signal the fallback so features can start polling; the auth
      // heartbeat remains the revocation fallback.
      this.stop()
      this.onFallbackCb?.()
      return
    }
    if (!res.ok || !res.body) {
      if (this.started && !this.destroyed) this._scheduleReconnect()
      return
    }

    this._armSilence(epoch)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (epoch !== this.connEpoch) return // superseded — abandon this loop
        // Any byte (named event OR `:keepalive` comment) proves the connection is
        // live — reset backoff + re-arm the silence watchdog. (Resetting here, not
        // on a dispatched frame, means a healthy-but-quiet stream — only keepalives
        // + events this consumer doesn't handle — still clears stale backoff.)
        this.reconnectAttempts = 0
        this._armSilence(epoch)
        // Normalize CRLF→LF so frame splitting on '\n\n' is uniform even when a
        // proxy rewrites the server's LF line endings. A trailing '\r' waits in
        // the buffer until its '\n' arrives on the next chunk.
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
        // Never grow without bound — a peer that never sends a frame terminator
        // must not OOM us. Drop the connection; the reconnect below re-opens it.
        if (buffer.length > MAX_BUFFER_BYTES) break
        // SSE frames are separated by a blank line. Process every complete one;
        // keep the trailing partial in `buffer`.
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          this._dispatchFrame(frame)
        }
      }
    } catch {
      // Read error (abort or network drop) — falls through to reconnect below.
    }
    // Stream ended (server closed / dropped) — reconnect unless we're the stale
    // loop or were deliberately stopped.
    if (epoch === this.connEpoch && this.started && !this.destroyed) this._scheduleReconnect()
  }

  /** Parse one SSE frame (`event:`/`data:` lines) and dispatch to handlers. */
  private _dispatchFrame(frame: string): void {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (line.length === 0 || line.startsWith(':')) continue // blank / keepalive comment
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      // Per spec, one optional space after the colon is stripped.
      let val = colon === -1 ? '' : line.slice(colon + 1)
      if (val.startsWith(' ')) val = val.slice(1)
      if (field === 'event') eventName = val
      else if (field === 'data') dataLines.push(val)
    }
    const handlers = this.handlers.get(eventName)
    if (!handlers || handlers.length === 0) return
    let data: Record<string, unknown> = {}
    const raw = dataLines.join('\n')
    if (raw.length > 0) {
      try { data = JSON.parse(raw) as Record<string, unknown> } catch { /* some events carry empty/non-JSON data */ }
    }
    for (const handler of handlers) {
      try { handler(data) } catch { /* a handler error must never break the stream */ }
    }
  }

  private _armSilence(epoch: number): void {
    this._clearSilence()
    this.silenceTimer = setTimeout(() => {
      // No byte for SILENCE_TIMEOUT_MS → the connection is dead. Abort and
      // reconnect (only if still the current connection).
      if (epoch !== this.connEpoch || this.destroyed || !this.started) return
      // Invalidate the current read loop BEFORE aborting so its own abort-driven
      // exit doesn't ALSO schedule a reconnect (which would double-increment the
      // backoff counter for one death event).
      this.connEpoch++
      this._abort()
      this._scheduleReconnect()
    }, SILENCE_TIMEOUT_MS)
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || !this.started) return
    this._clearSilence()
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts++
    // Full jitter over [0, base) — desynchronises a fleet reconnecting after a
    // deploy/restart so they don't stampede the connection pool.
    const delay = Math.floor(Math.random() * base)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this._connect()
    }, delay)
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private _clearSilence(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  private _abort(): void {
    if (this.controller !== null) {
      this.controller.abort()
      this.controller = null
    }
  }
}
