/**
 * How wide a hosted surface's window opens.
 *
 * The store and portal are laid out as a FIXED content column (432px portal,
 * 360px store cards) that does not grow with the viewport. In a browser it sits
 * centred in whitespace and reads as a modest card; in a 480px window it IS the
 * window — content touching both edges, two and a half cards visible, and the
 * whole thing reading as enormous.
 *
 * That was measured on 2026-08-19 and the measurement mattered: every rendered
 * size was exactly what the tenant had configured. Nothing was scaled up. The
 * container was too narrow, so the fix is the window, not the design — and
 * shrinking the type would have "fixed" something that was not broken.
 */
import { describe, it, expect } from 'vitest'
import { hostedWindowSize } from './auth'

const NARROW = { width: 480, minWidth: 440 }
const WIDE = { width: 780, minWidth: 560 }

describe('hostedWindowSize', () => {
  it('gives the store room', () => {
    expect(hostedWindowSize('https://st.onelo.tools/store/hosted?token=srt_1')).toEqual(WIDE)
  })

  it('gives the customer portal room', () => {
    expect(hostedWindowSize('https://st.onelo.tools/customer/portal?token=pt_1')).toEqual(WIDE)
  })

  it('keeps SIGN-IN slim', () => {
    // A single 300px form column looks right in a slim window and lost in a
    // wide one — this is not "narrow is wrong", it is "narrow is wrong HERE".
    expect(hostedWindowSize('https://st.onelo.tools/auth/hosted?token=art_1')).toEqual(NARROW)
  })

  it('keeps the no-plan surface slim', () => {
    // A heading, a line of text and one button. Reached by the Access Gate deep
    // link, which goes through the same presenter.
    expect(hostedWindowSize('https://st.onelo.tools/no-plan/hosted?token=npt_1')).toEqual(NARROW)
  })

  it('falls back to slim on an unparsable URL', () => {
    // The narrow pair is what every surface used before this existed, so an
    // unreadable URL degrades to the previous behaviour rather than to a guess.
    expect(hostedWindowSize('not a url')).toEqual(NARROW)
  })

  it('is not fooled by the path appearing elsewhere in the URL', () => {
    // Matching on the PATH, not the whole string: a query parameter that
    // happens to contain "/store/" must not widen a sign-in window.
    expect(hostedWindowSize('https://st.onelo.tools/auth/hosted?return_to=/store/hosted'))
      .toEqual(NARROW)
  })
})
