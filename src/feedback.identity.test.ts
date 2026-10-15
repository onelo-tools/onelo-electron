import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { OneloFeedback } from './feedback'
import { OneloFeatures } from './features'
import type { UserTokenSource } from './user-token'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

/**
 * #820 — a signed-in Onelo Auth user's report names a VERIFIED reporter: the
 * initiate call carries `Authorization: Bearer <access token>`. Signed out,
 * nothing is sent (anonymous); an explicit `userId` stays an unverified label.
 * A real local HTTP server sees the exact headers the SDK sends.
 */
describe('OneloFeedback — Onelo Auth reporter (#820)', () => {
  let server: http.Server
  let apiUrl = ''
  let seen: http.IncomingHttpHeaders[] = []
  let answers: number[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(req.headers)
      const status = answers.shift() ?? 200
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(status === 200
        ? { hosted_url: 'https://onelo.tools/feedback/hosted?ft=x' }
        : { detail: { error: 'invalid_user_token' } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })
  beforeEach(() => { seen = []; answers = [] })

  const source = (token: string | null, refreshed: string | null = null): UserTokenSource => ({
    current: async () => token,
    refresh: async () => refreshed,
  })
  const make = (s?: UserTokenSource) =>
    new OneloFeedback({ publishableKey: 'pk_test_123', apiUrl }, new OneloFeatures('pk_test_123', apiUrl), s)
  const initiate = (fb: OneloFeedback, opts?: { userId?: string }) =>
    (fb as unknown as { _initiate: (o?: unknown) => Promise<{ ok: boolean }> })._initiate(opts)

  it('signed in: sends the access token as Bearer, no userId needed', async () => {
    const r = await initiate(make(source('AT_1')))
    expect(r.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]['authorization']).toBe('Bearer AT_1')
    expect(seen[0]['x-onelo-user-id']).toBeUndefined()
  })

  it('signed out: no Authorization and no userId — anonymous', async () => {
    await initiate(make(source(null)))
    expect(seen[0]['authorization']).toBeUndefined()
    expect(seen[0]['x-onelo-user-id']).toBeUndefined()
  })

  it('signed out with an explicit userId: the unverified label still travels', async () => {
    await initiate(make(source(null)), { userId: 'dev-42' })
    expect(seen[0]['authorization']).toBeUndefined()
    expect(seen[0]['x-onelo-user-id']).toBe('dev-42')
  })

  it('a refused token is refreshed once and retried with the fresh one', async () => {
    answers = [401]
    const r = await initiate(make(source('AT_OLD', 'AT_NEW')))
    expect(r.ok).toBe(true)
    expect(seen.map((h) => h['authorization'])).toEqual(['Bearer AT_OLD', 'Bearer AT_NEW'])
  })

  it('refused even after refresh: the form still opens, without the token', async () => {
    answers = [401, 401]
    const r = await initiate(make(source('AT_OLD', 'AT_NEW')), { userId: 'dev-42' })
    expect(r.ok).toBe(true)
    expect(seen).toHaveLength(3)
    expect(seen[2]['authorization']).toBeUndefined()
    expect(seen[2]['x-onelo-user-id']).toBe('dev-42')
  })
})
