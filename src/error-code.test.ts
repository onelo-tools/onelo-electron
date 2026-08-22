import { describe, it, expect } from 'vitest'
import { extractErrorCode } from '@onelo/core'

// Lives here (not in onelo-core) because onelo-core has no test runner of its own;
// electron is the canonical consumer and already resolves @onelo/core via workspace link.
describe('extractErrorCode', () => {
  it('reads a flat { error }', () => {
    expect(extractErrorCode({ error: 'store_not_configured' })).toBe('store_not_configured')
  })

  it('reads a nested FastAPI { detail: { error } }', () => {
    expect(
      extractErrorCode({ detail: { error: 'in_app_store_not_allowed', message: 'Use IAP' } }),
    ).toBe('in_app_store_not_allowed')
  })

  it('reads { detail } when detail is a plain string', () => {
    expect(extractErrorCode({ detail: 'paywall_not_enabled' })).toBe('paywall_not_enabled')
  })

  it('prefers a flat error over detail', () => {
    expect(extractErrorCode({ error: 'flat', detail: { error: 'nested' } })).toBe('flat')
  })

  it('returns undefined when there is no code', () => {
    expect(extractErrorCode(null)).toBeUndefined()
    expect(extractErrorCode(undefined)).toBeUndefined()
    expect(extractErrorCode({})).toBeUndefined()
    expect(extractErrorCode({ detail: {} })).toBeUndefined()
    expect(extractErrorCode({ detail: 42 })).toBeUndefined()
    expect(extractErrorCode({ error: '' })).toBeUndefined()
    expect(extractErrorCode('boom')).toBeUndefined()
  })

  it('returns unknown codes verbatim (forward-compat)', () => {
    expect(extractErrorCode({ detail: { error: 'some_future_code' } })).toBe('some_future_code')
  })
})
