import { beforeEach, describe, expect, it } from 'vitest'
import { AFFILIATE_STORAGE_KEY, OneloAffiliates, queryOf, type AffiliateStore } from './affiliates'

const CLICK = '11111111-2222-3333-4444-555555555555'

class Mem implements AffiliateStore {
  m = new Map<string, string>()
  async get(k: string) { return this.m.get(k) ?? null }
  async set(k: string, v: string) { this.m.set(k, v) }
}

let store: Mem
let calls: Array<[string, Record<string, unknown>]>

function make(signedIn = true, reply: (p: string) => Record<string, unknown> = () => ({})) {
  return new OneloAffiliates('onelo_pk_x', store, async (path, body) => {
    calls.push([path, body])
    return { status: 200, json: reply(path) }
  }, async () => (signedIn ? { accessToken: 'tok', userId: 'u1' } : null))
}

beforeEach(() => { store = new Mem(); calls = [] })

describe('OneloAffiliates (Electron, #929)', () => {
  it('parses deep-link queries', () => {
    expect(queryOf('myapp://open?ref=abc123def&x=%20y#frag')).toEqual({ ref: 'abc123def', x: ' y' })
  })

  it('refusal stores nothing and only counts', async () => {
    expect((await make().capture('myapp://open?ref=abcdef1234', { consent: false })).kept).toBe(false)
    expect(store.m.size).toBe(0)
    expect(calls.map((c) => c[0])).toEqual(['/v1/sdk/affiliates/refused'])
  })

  it('consented ref is kept and claimed once', async () => {
    const aff = make(true, (p) => (p.endsWith('/click') ? { click_id: CLICK } : { claimed: true }))
    expect((await aff.capture('https://app.test/x?ref=ABCDEF1234', { consent: true })).kept).toBe(true)
    expect(calls.map((c) => c[0])).toEqual(['/v1/sdk/affiliates/click', '/v1/sdk/affiliates/claim'])
    expect(calls[0][1]).toMatchObject({ code: 'abcdef1234', source: 'sdk' })
    expect(calls[1][1]).toMatchObject({ userToken: 'tok', clickId: CLICK })
    expect(await aff.kept()).toEqual({ click_id: CLICK, claimed_for: 'u1' })
    await aff.claimForSession()
    expect(calls).toHaveLength(2)
  })

  it('forwarded click replaces an earlier one', async () => {
    store.m.set(AFFILIATE_STORAGE_KEY, JSON.stringify({ click_id: '99999999-2222-3333-4444-555555555555' }))
    const aff = make(false)
    await aff.capture(`myapp://open?onelo_click=${CLICK}`, { consent: true })
    expect((await aff.kept())?.click_id).toBe(CLICK)
    expect(calls).toHaveLength(0)
  })

  it('existing click is sent so Onelo applies the winner', async () => {
    store.m.set(AFFILIATE_STORAGE_KEY, JSON.stringify({ click_id: CLICK }))
    await make(false, () => ({ click_id: CLICK, kept: true })).capture('myapp://open?ref=zzzzzz9999', { consent: true })
    expect(calls[0][1]).toMatchObject({ existing: CLICK })
  })

  it('junk parameters are ignored', async () => {
    expect((await make().capture('myapp://open?ref=%3Cx%3E&onelo_click=nope', { consent: true })).kept).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
