import { describe, it, expect } from 'vitest'
import { getCodesignFingerprint, getCachedCodesignFingerprint } from './codesign'

describe('codesign fingerprint', () => {
  it('returns null or a 64-char hex string', () => {
    const fp = getCodesignFingerprint()
    if (fp !== null) {
      expect(fp).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('getCachedCodesignFingerprint returns the same value on repeated calls', () => {
    const a = getCachedCodesignFingerprint()
    const b = getCachedCodesignFingerprint()
    expect(a).toEqual(b)
  })
})
