/**
 * Affiliate referral capture for apps with the Onelo SDK (#929).
 *
 * An Affiliate link that opens your app carries `?ref=<code>` (the Affiliate
 * linking straight to the app) or `?onelo_click=<id>` (forwarded by Onelo's
 * tracked link after consent there). Pass that link with the user's answer:
 *
 *   app.on('open-url', (_e, url) => onelo.affiliates.capture(url, { consent }))
 *
 * - `consent: false` stores nothing on the device; a `?ref=` only adds one to
 *   the Affiliate's anonymous total.
 * - `consent: true` keeps the click (safeStorage entry `onelo_aff`, Main process). Which of two
 *   clicks stays is the program's winner rule, decided by Onelo.
 *
 * The kept click is tied to the user who signs in, so their purchase is
 * attributed whichever checkout opens.
 */
export const AFFILIATE_STORAGE_KEY = 'onelo_aff'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[A-Za-z0-9]{6,32}$/

export interface AffiliateStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

type Post = (path: string, body: Record<string, unknown>) => Promise<{ status: number; json: Record<string, unknown> } | null>
type Session = () => Promise<{ accessToken: string; userId: string } | null>

interface Kept { click_id: string; claimed_for?: string }

/** The query of a deep link or https URL, without relying on a URL polyfill. */
export function queryOf(url: string): Record<string, string> {
  const q = url.split('#')[0].split('?')[1] ?? ''
  const out: Record<string, string> = {}
  for (const part of q.split('&')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    try {
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '))
    } catch { /* malformed: skip */ }
  }
  return out
}

export class OneloAffiliates {
  constructor(
    private readonly publishableKey: string,
    private readonly store: AffiliateStore,
    private readonly post: Post,
    private readonly session: Session,
  ) {}

  async kept(): Promise<Kept | null> {
    try {
      const raw = await this.store.get(AFFILIATE_STORAGE_KEY)
      const parsed = raw ? (JSON.parse(raw) as Kept) : null
      return parsed && typeof parsed.click_id === 'string' && UUID.test(parsed.click_id) ? parsed : null
    } catch {
      return null
    }
  }

  private keep(kept: Kept): Promise<void> {
    return this.store.set(AFFILIATE_STORAGE_KEY, JSON.stringify(kept))
  }

  /** Capture the referral in `url` after the user's answer. Stores nothing without consent. */
  async capture(url: string, { consent }: { consent: boolean }): Promise<{ kept: boolean }> {
    const q = queryOf(url)
    const code = q.ref && CODE.test(q.ref) ? q.ref.toLowerCase() : null
    const forwarded = q.onelo_click && UUID.test(q.onelo_click) ? q.onelo_click : null
    if (!consent) {
      if (code) await this.post('/v1/sdk/affiliates/refused', { publishableKey: this.publishableKey, code })
      return { kept: false }
    }
    const existing = await this.kept()
    if (code) {
      const res = await this.post('/v1/sdk/affiliates/click', {
        publishableKey: this.publishableKey, code, source: 'sdk',
        ...(existing ? { existing: existing.click_id } : {}),
      })
      const id = res?.json.click_id
      if (res?.status === 200 && typeof id === 'string' && UUID.test(id) && id !== existing?.click_id) {
        await this.keep({ click_id: id })
      }
    } else if (forwarded && forwarded !== existing?.click_id) {
      // Onelo's tracked link already recorded this click and applied the
      // program's winner rule; the id it forwards is the one to keep.
      await this.keep({ click_id: forwarded })
    }
    await this.claimForSession()
    return { kept: (await this.kept()) !== null }
  }

  /** Tie the kept click to the signed-in user once. Called on every sign-in. */
  async claimForSession(): Promise<void> {
    const kept = await this.kept()
    if (!kept) return
    const s = await this.session().catch(() => null)
    if (!s || kept.claimed_for === s.userId) return
    const res = await this.post('/v1/sdk/affiliates/claim', {
      publishableKey: this.publishableKey, userToken: s.accessToken, clickId: kept.click_id,
    })
    if (res?.status === 200) await this.keep({ ...kept, claimed_for: s.userId })
  }
}

/** The SDK's transport: same security headers as every other module. */
export function affiliatePost(apiUrl: string, bundleId?: string): Post {
  return async (path, body) => {
    try {
      const { sdkHeaders } = await import('./sdk-headers')
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { ...sdkHeaders(bundleId), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { status: res.status, json }
    } catch {
      return null
    }
  }
}

/**
 * Its own encrypted file (`onelo/affiliates.enc`), so signing out — which
 * clears the token store — does not drop a referral not yet claimed.
 */
export function affiliateStore(): AffiliateStore {
  let inner: import('./storage').SecureTokenStorage | null = null
  const open = async () => {
    if (inner) return inner
    const { SecureTokenStorage } = await import('./storage')
    const { join } = await import('path')
    const { mkdirSync } = await import('fs')
    const { app } = require('electron')
    const dir = join(app.getPath('userData'), 'onelo')
    mkdirSync(dir, { recursive: true })
    inner = new SecureTokenStorage(join(dir, 'affiliates.enc'))
    return inner
  }
  return {
    async get(key) { try { return await (await open()).get(key) } catch { return null } },
    async set(key, value) { try { await (await open()).set(key, value) } catch { /* not kept */ } },
  }
}
