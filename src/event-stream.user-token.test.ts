/**
 * #518: the Electron Event Stream proves the signed-in user with
 * `Authorization: Bearer <access token>` on the stream GET, read fresh on EVERY
 * (re)connect. A refused token is refreshed and retried once; refused again,
 * that connection is opened anonymous (no Bearer, no userId).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OneloEventStream } from './event-stream'

/** A connected stream that stays open (a read that never resolves). */
function openStream(): Response {
  return {
    status: 200,
    ok: true,
    body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
  } as unknown as Response
}
function refused(): Response {
  return {
    status: 401,
    ok: false,
    body: null,
    json: async () => ({ detail: { error: 'invalid_user_token' } }),
  } as unknown as Response
}

type Seen = { url: string; auth: string | undefined }
function stubFetch(responses: Array<() => Response>) {
  const seen: Seen[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    seen.push({ url: String(url), auth: (init?.headers as Record<string, string>)['Authorization'] })
    const next = responses.length > 1 ? responses.shift()! : responses[0]
    return next()
  })
  return seen
}

function tokens(current: string | null, refreshed: string | null = 'fresh') {
  return { current: vi.fn(async () => current), refresh: vi.fn(async () => refreshed) }
}
const userIdOf = (s: Seen) => new URL(s.url).searchParams.get('userId')

describe('OneloEventStream (Electron) — user token on the stream (#518)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('signed in: the stream GET carries Authorization: Bearer <access token>', async () => {
    const seen = stubFetch([openStream])
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', undefined, undefined, tokens('access-1'))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(seen).toHaveLength(1) })
      expect(seen[0].auth).toBe('Bearer access-1')
      expect(userIdOf(seen[0])).toBe('u1')
    } finally { stream.destroy() }
  })

  it('every reconnect reads a current token', async () => {
    const seen = stubFetch([openStream])
    let current = 'access-1'
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', undefined, undefined, {
      current: async () => current, refresh: async () => null,
    })
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(seen).toHaveLength(1) })
      current = 'access-2'
      stream.reconnect()
      await vi.waitFor(() => { expect(seen).toHaveLength(2) })
      expect(seen.map((s) => s.auth)).toEqual(['Bearer access-1', 'Bearer access-2'])
    } finally { stream.destroy() }
  })

  it('signed out: no Authorization header', async () => {
    const seen = stubFetch([openStream])
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', undefined, undefined, tokens(null))
    stream.start(null)
    try {
      await vi.waitFor(() => { expect(seen).toHaveLength(1) })
      expect(seen[0].auth).toBeUndefined()
    } finally { stream.destroy() }
  })

  it('invalid_user_token → refresh once, reconnect with the new token as the user', async () => {
    const seen = stubFetch([refused, openStream])
    const source = tokens('stale')
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', undefined, undefined, source)
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(seen).toHaveLength(2) })
      expect(seen.map((s) => s.auth)).toEqual(['Bearer stale', 'Bearer fresh'])
      expect(userIdOf(seen[1])).toBe('u1')
      expect(source.refresh).toHaveBeenCalledTimes(1)
    } finally { stream.destroy() }
  })

  it('refused again → opened anonymous (no Bearer, no userId), warned, no loop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen = stubFetch([refused, refused, openStream])
    const stream = new OneloEventStream('https://api.example.com', 'onelo_pk_test', undefined, undefined, tokens('stale'))
    stream.start('u1')
    try {
      await vi.waitFor(() => { expect(seen).toHaveLength(3) })
      await new Promise((r) => setTimeout(r, 20))
      expect(seen).toHaveLength(3)
      expect(seen.map((s) => s.auth)).toEqual(['Bearer stale', 'Bearer fresh', undefined])
      expect(userIdOf(seen[2])).toBeNull()
      expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
    } finally { stream.destroy() }
  })
})
