import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('./codesign', () => ({
  getCachedCodesignFingerprint: vi.fn().mockReturnValue(null),
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: {
      tenant_id: 'tenant-1',
      allow_custom_branding: false,
    }}),
    httpPost: vi.fn().mockResolvedValue({ status: 204, json: {} }),
  }
})

import { OneloElectronAuth } from './auth'

describe('OneloElectronAuth heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts timer on saveSession and stops on signOut', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'pk_test' })
    // @ts-ignore
    const startSpy = vi.spyOn(auth as any, 'startHeartbeat')
    // @ts-ignore
    const stopSpy = vi.spyOn(auth as any, 'stopHeartbeat')

    // Trigger saveSession directly via private method
    // @ts-ignore
    await (auth as any).saveSession({
      accessToken: 'tok',
      refreshToken: 'rtok',
      expiresAt: Math.floor(Date.now() / 1000) + 900,
      user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null },
    })

    expect(startSpy).toHaveBeenCalledWith('tok')
    await auth.signOut()
    expect(stopSpy).toHaveBeenCalled()
  })
})
