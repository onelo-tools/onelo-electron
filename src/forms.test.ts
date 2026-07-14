import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OneloForms } from './forms'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)
}

describe('OneloForms', () => {
  const forms = new OneloForms('https://api.onelo.tools', 'onelo_pk_test')

  beforeEach(() => mockFetch.mockReset())

  it('returns success true on 200', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true, message: 'Thanks!' }))
    const result = await forms.submit('feedback', { name: 'Ada' })
    expect(result.success).toBe(true)
  })

  it('sends formSlug, data, publishableKey', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true }))
    await forms.submit('contact', { msg: 'hello' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.formSlug).toBe('contact')
    expect(body.data).toEqual({ msg: 'hello' })
    expect(body.publishableKey).toBe('onelo_pk_test')
  })

  it('sends submitterEmail when provided', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true }))
    await forms.submit('feedback', {}, 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.submitterEmail).toBe('ada@example.com')
  })

  it('returns success false on error', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = () => { throw new Error('Network failed') }
      const result = await forms.submit('feedback', {})
      expect(result.success).toBe(false)
      expect(result.message).toContain('Network failed')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
