import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OneloFeedback,
  POSTMESSAGE_RELAY_SCRIPT,
  FEEDBACK_CLOSE_SENTINEL,
  FEEDBACK_SUBMITTED_SENTINEL,
} from './feedback'
import { OneloFeatures } from './features'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    on: vi.fn(),
    webContents: { on: vi.fn() },
    close: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  })),
}))

const MOCK_CONFIG = {
  publishableKey: 'pk_test_123',
  apiUrl: 'https://api.onelo.tools',
}

function makeFeatures(active: string[] = []): OneloFeatures {
  const f = new OneloFeatures('pk_test_123', 'https://api.onelo.tools')
  // cache holds FeatureRecord ({ status, upgradeCta, … }) since 0.24.0.
  const cache = (f as unknown as { cache: Map<string, { status: string; upgradeCta: boolean }> }).cache
  for (const name of active) {
    cache.set(name, { status: 'enabled', upgradeCta: false })
  }
  return f
}

describe('OneloFeedback', () => {
  let feedback: OneloFeedback

  beforeEach(() => {
    feedback = new OneloFeedback(MOCK_CONFIG, makeFeatures())
    vi.clearAllMocks()
  })

  describe('buildInitiateUrl()', () => {
    it('includes publishableKey', () => {
      expect(feedback.buildInitiateUrl()).toContain('key=pk_test_123')
    })

    it('includes type when provided', () => {
      expect(feedback.buildInitiateUrl({ type: 'bug' })).toContain('type=bug')
    })

    it('includes area when provided', () => {
      expect(feedback.buildInitiateUrl({ area: 'checkout' })).toContain('area=checkout')
    })

    it('includes active feature flags as session', () => {
      const features = makeFeatures(['checkout', 'ai-chat'])
      const fb = new OneloFeedback(MOCK_CONFIG, features)
      const url = fb.buildInitiateUrl()
      expect(url).toContain('session=')
      expect(decodeURIComponent(url)).toContain('checkout')
    })

    it('omits session param when no active features', () => {
      expect(feedback.buildInitiateUrl()).not.toContain('session=')
    })
  })

  describe('track() shim', () => {
    it('does not throw', () => {
      expect(() => feedback.track('checkout')).not.toThrow()
    })
  })

  describe('hosted close ✕ (onelo:feedback_close)', () => {
    it('relay forwards the hosted feedback_close message to the close sentinel', () => {
      // The hosted page (frontend HostedCloseX) postMessages onelo:feedback_close
      // when its ✕ is tapped; the injected relay must convert it to the sentinel
      // the will-navigate interceptor closes on — twin of feedback_submitted.
      expect(POSTMESSAGE_RELAY_SCRIPT).toContain("e.data.type === 'onelo:feedback_close'")
      expect(POSTMESSAGE_RELAY_SCRIPT).toContain(`window.location.href = '${FEEDBACK_CLOSE_SENTINEL}'`)
    })

    it('still relays the submitted message (unchanged twin)', () => {
      expect(POSTMESSAGE_RELAY_SCRIPT).toContain("e.data.type === 'onelo:feedback_submitted'")
      expect(POSTMESSAGE_RELAY_SCRIPT).toContain(`window.location.href = '${FEEDBACK_SUBMITTED_SENTINEL}'`)
    })
  })

  describe('error screen — Retry button (Swift parity)', () => {
    it('renders a "Try again" button pointing at the retry sentinel + HTML-escapes the message', async () => {
      const loaded: string[] = []
      // Inject a minimal window so _showError renders into it.
      ;(feedback as unknown as { window: unknown }).window = {
        isDestroyed: () => false,
        loadURL: (u: string) => { loaded.push(u); return Promise.resolve() },
      }
      await (feedback as unknown as { _showError(m: string): Promise<void> })._showError('boom & <bad>')
      expect(loaded).toHaveLength(1)
      const html = decodeURIComponent(loaded[0])
      // The Retry affordance that brings Electron to 1:1 with Swift (JS just throws).
      expect(html).toContain('onelo://feedback_retry')
      expect(html).toContain('Try again')
      // no-silent-swallow: the actual error is shown, and escaped.
      expect(html).toContain('boom &amp; &lt;bad&gt;')
    })
  })
})
