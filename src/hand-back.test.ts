import { describe, it, expect } from 'vitest'
import { classifyHandBack } from './hand-back'

/**
 * #615 — the one Store Hand-back decoder. Every `<scheme>://callback` shape the
 * hosted store and portal send; the store/auth window and the portal window
 * both decide from this.
 */
describe('classifyHandBack', () => {
  it.each([
    ['purchase (P1/P2)', 'myapp://callback?code=oac_1', { kind: 'purchase', code: 'oac_1' }],
    ['interval switch (P3)', 'myapp://callback?source=store&event=plan_switched', { kind: 'switched', reason: 'plan_switched' }],
    ['lagging paid switch (P3t)', 'myapp://callback?source=store&event=plan_switch_pending', { kind: 'switched', reason: 'plan_switch_pending' }],
    ['scheduled downgrade (P5)', 'MyApp://callback?source=store&event=switch_scheduled', { kind: 'switched', reason: 'switch_scheduled' }],
    ['switch without a reason', 'myapp://callback?source=store', { kind: 'switched', reason: '' }],
    ['portal Done (P8)', 'myapp://callback?source=portal', { kind: 'portal_closed', event: null }],
    ['portal Done + event', 'myapp://callback?source=portal&event=account_revoked', { kind: 'portal_closed', event: 'account_revoked' }],
    ['expired Return to app (P14)', 'myapp://callback?error=token_expired', { kind: 'error', error: 'token_expired' }],
  ])('%s', (_n, url, expected) => {
    expect(classifyHandBack(url, 'myapp')).toEqual(expected)
  })

  it.each([
    ['another scheme', 'otherapp://callback?source=store&event=plan_switched'],
    ['another host', 'myapp://evil?source=store&event=plan_switched'],
    ['the renew sentinel', 'myapp://renew-portal?request_id=r1'],
    ['a web page', 'https://st.onelo.tools/store/hosted?source=store'],
    ['a bare callback', 'myapp://callback'],
  ])('ignores %s', (_n, url) => {
    expect(classifyHandBack(url, 'myapp')).toBeNull()
  })
})
