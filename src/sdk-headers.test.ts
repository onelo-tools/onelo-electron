import { describe, it, expect, vi } from 'vitest'

vi.mock('./codesign', () => ({
  getCachedCodesignFingerprint: vi.fn().mockReturnValue(null),
  getCodesignOS: vi.fn().mockReturnValue(null),
}))
vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockReturnValue('inst-1') }))

import { sdkHeaders } from './sdk-headers'
import { version } from '../package.json'

describe('sdkHeaders identity (#122)', () => {
  it('names this SDK by its registry key next to its version', () => {
    const h = sdkHeaders()
    expect(h['X-SDK-Version']).toBe(version)
    expect(h['X-Onelo-Sdk-Name']).toBe('onelo-electron')
  })

  it('keeps the discovery platform tag as js — the two headers answer different questions', () => {
    expect(sdkHeaders()['X-Onelo-Sdk-Platform']).toBe('js')
  })

  it('cannot be overridden by per-call extras — neither half of the pair', () => {
    // An extra header may add, never re-label the SDK or its version: the two
    // are captured together and must never disagree.
    const h = sdkHeaders({ 'X-Onelo-Sdk-Name': 'onelo-js', 'X-SDK-Version': '0.0.0' })
    expect(h['X-Onelo-Sdk-Name']).toBe('onelo-electron')
    expect(h['X-SDK-Version']).toBe(version)
  })
})
