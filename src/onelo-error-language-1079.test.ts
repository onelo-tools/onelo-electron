/**
 * #1079 — an `OneloError` message an App User may be shown (from @onelo/core)
 * follows the Page Language this SDK adopts, like its own texts (#1078). The
 * error code does not change; messages that address the developer stay English.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  shell: { openExternal: vi.fn(async () => true) },
  app: { getPreferredSystemLanguages: () => ['de-DE'], on: vi.fn() },
}))
const kept = new Map<string, string>()
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => kept.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { kept.set(k, v) }),
    delete: vi.fn(async (k: string) => { kept.delete(k) }),
    clear: vi.fn(async () => { kept.clear() }),
    hasKeysSync: vi.fn(() => false),
  })),
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))

let configAnswer: Record<string, unknown> = {}
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => url.includes('/api/sdk/config')
      ? { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: [], paywall_enabled: false,
          ...configAnswer,
        } }
      : { status: 404, json: {} }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { OneloError, pageLanguage as corePageLanguage } from '@onelo/core'
import { OneloElectronAuth } from './auth'
import { adoptPageLanguage, resetPageLanguageForTest } from './text'

beforeEach(() => {
  resetPageLanguageForTest()
  kept.clear()
  configAnswer = {}
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] })
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetPageLanguageForTest()
})

describe('OneloError messages follow the Page Language (#1079)', () => {
  it('English until the backend answers', () => {
    expect(OneloError.sessionEnded().message).toBe('Your session ended — please sign in again')
  })

  it('the answer of /api/sdk/config reaches the error messages; the code is unchanged', async () => {
    configAnswer = { page_language: 'fr' }
    const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
    await (auth as unknown as { initPromise: Promise<void> }).initPromise
    expect(auth.pageLanguage).toBe('fr')
    expect(corePageLanguage()).toBe('fr')
    const e = OneloError.sessionEnded()
    expect(e.code).toBe('session_ended')
    expect(e.message).toBe('Votre session a pris fin — veuillez vous reconnecter')
  })

  it('the language kept from the last launch reaches them too', () => {
    adoptPageLanguage('nl-NL')
    expect(OneloError.cancelled().message).toBe('Inloggen is geannuleerd')
    expect(OneloError.invalidKey('x').message).toBe('Invalid publishable key: x')
  })
})
