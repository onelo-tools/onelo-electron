// #681 — the Electron SDK's own chrome (error pages with "Try again", the
// portal and feedback skeletons, the window grounds) is painted from the
// backend's `brand_tokens`, never from hard-coded dark literals.
import { describe, it, expect } from 'vitest'
import { parseBrandTokens, NEUTRAL_BRAND_TOKENS, type BrandTokens } from '@onelo/core'
import { brandErrorPageHtml, portalSkeletonHtml, feedbackSkeletonHtml } from './brand-chrome'

const T: BrandTokens = parseBrandTokens({
  version: 1,
  page_bg: '#f5f5f4',
  brand: '#e4007c',
  card_bg: '#ffffff',
  text: '#111111',
  text_muted: 'rgba(17,17,17,0.65)',
  border: '#e4e4e7',
  button_bg: '#00aa55',
  button_text: '#010101',
  button_radius: 3,
  field_radius: 7,
  card_radius: 21,
  body_font: "'Poppins', sans-serif",
  heading_font: "'Lato', sans-serif",
  spinner_track: 'rgba(0,0,0,0.12)',
  light_bg: true,
})!

describe('Electron chrome from brand_tokens (#681)', () => {
  it('the error page with "Try again" is page_bg / text / button tokens', () => {
    const html = brandErrorPageHtml(T, {
      title: "Couldn't start sign-in",
      message: 'Something went wrong.',
      retryHref: 'onelo-retry://retry',
    })
    expect(html).toContain('background:#f5f5f4')
    expect(html).toContain('color:#111111')
    expect(html).toContain('color:rgba(17,17,17,0.65)')
    expect(html).toContain('background:#00aa55')
    expect(html).toContain('color:#010101')
    expect(html).toContain('border-radius:3px')
    expect(html).toContain("font-family:'Poppins', sans-serif")
    expect(html).not.toMatch(/#ffffff;color:#111111/)
  })

  it('skeletons: page ground, card/border blocks, card and button radii', () => {
    const portal = portalSkeletonHtml(T)
    expect(portal).toContain('body{background:#f5f5f4')
    expect(portal).toContain('background-color:#ffffff')
    expect(portal).toContain('border-radius:21px')
    const fb = feedbackSkeletonHtml(T)
    expect(fb).toContain('background:#f5f5f4')
    expect(fb).toContain('.btn{width:100%;height:48px;border-radius:3px}')
  })

  it('neutral before config — never Onelo orange', () => {
    const html = brandErrorPageHtml(NEUTRAL_BRAND_TOKENS, { title: 't', message: 'm', retryHref: 'x://y' })
    expect(html).not.toMatch(/f97316|ffa100/i)
    expect(html).toContain(`background:${NEUTRAL_BRAND_TOKENS.button_bg}`)
  })
})
