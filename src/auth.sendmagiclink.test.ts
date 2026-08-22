import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)
}

const CONFIG_RESPONSE = {
  supabase_url: 'https://test.supabase.co',
  supabase_anon_key: 'anon',
  tenant_id: 't1',
  allow_custom_branding: false,
  app_name: 'App',
  app_logo_url: null,
}

describe('OneloElectronAuth — magic link & password reset', () => {
  beforeEach(() => mockFetch.mockReset())

  it('sendMagicLink calls /api/sdk/auth/magic-link', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      if (url && url.includes('/api/sdk/auth/magic-link')) return mockResponse(200, { success: true })
      return mockResponse(404, {})
    })
    const { OneloElectronAuth } = await import('./auth')
    const auth = new OneloElectronAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.sendMagicLink('ada@example.com')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sdk/auth/magic-link'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sendMagicLink includes redirectTo when provided', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      if (url && url.includes('/api/sdk/auth/magic-link')) return mockResponse(200, { success: true })
      return mockResponse(404, {})
    })
    const { OneloElectronAuth } = await import('./auth')
    const auth = new OneloElectronAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.sendMagicLink('ada@example.com', 'myapp://callback')
    const call = mockFetch.mock.calls.find((c: unknown[]) => c[0] && (c[0] as string).includes('magic-link'))
    const body = JSON.parse((call![1] as { body: string }).body)
    expect(body.redirectTo).toBe('myapp://callback')
  })

  it('sendPasswordReset calls /api/sdk/auth/reset-password', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      if (url && url.includes('/api/sdk/auth/reset-password')) return mockResponse(200, { success: true })
      return mockResponse(404, {})
    })
    const { OneloElectronAuth } = await import('./auth')
    const auth = new OneloElectronAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.sendPasswordReset('ada@example.com')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sdk/auth/reset-password'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sendPasswordReset includes redirectTo when provided', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      if (url && url.includes('/api/sdk/auth/reset-password')) return mockResponse(200, { success: true })
      return mockResponse(404, {})
    })
    const { OneloElectronAuth } = await import('./auth')
    const auth = new OneloElectronAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.sendPasswordReset('ada@example.com', 'myapp://reset')
    const call = mockFetch.mock.calls.find((c: unknown[]) => c[0] && (c[0] as string).includes('reset-password'))
    const body = JSON.parse((call![1] as { body: string }).body)
    expect(body.redirectTo).toBe('myapp://reset')
  })

  it('sends NO code_challenge while the verifier is volatile', async () => {
  // Deliberately ABSENT. Binding a PKCE challenge to a magic link is the right
  // design and the backend supports it, but the verifier here is in-memory and is
  // nulled after every password sign-in — while a magic link is opened later,
  // usually after a relaunch. A challenge bound to a verifier that no longer
  // exists makes /hosted-callback 401 AFTER the token is already marked used, so
  // the link is permanently burnt and the user has no way back. Pinned so it
  // cannot be "restored" without persisting the verifier first.
    mockFetch.mockImplementation((url: string) => {
      if (url && url.includes('/api/sdk/config')) return mockResponse(200, CONFIG_RESPONSE)
      if (url && url.includes('/api/sdk/auth/magic-link')) return mockResponse(200, { success: true })
      return mockResponse(404, {})
    })
    const { OneloElectronAuth } = await import('./auth')
    const auth = new OneloElectronAuth({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.onelo.tools' })
    await auth.whenReady()
    await auth.sendMagicLink('ada@example.com')
    const call = mockFetch.mock.calls.find((c) => String(c[0]).includes('/auth/magic-link'))
    expect(call).toBeDefined()
    const body = JSON.parse(String((call![1] as { body: string }).body))
    expect(body.code_challenge).toBeUndefined()
  })
})
