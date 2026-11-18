/**
 * #1039 — every SDK sends the device language when it opens a hosted page and
 * the App passes none; a language the App passes is sent unchanged. The backend
 * picks the Page Language within the App Languages (#1036); the SDK never
 * chooses. Same scenarios in every SDK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => true) } }))
vi.mock('./storage', () => ({
  SecureTokenStorage: vi.fn().mockImplementation(() => {
    const store = new Map<string, string>()
    return {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
      delete: vi.fn(async (k: string) => { store.delete(k) }),
      clear: vi.fn(async () => { store.clear() }),
    }
  }),
}))
vi.mock('./codesign', () => ({ getCachedCodesignFingerprint: vi.fn().mockReturnValue(null) }))
vi.mock('./instance-id', () => ({ getInstanceId: () => 'inst-test' }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: [], paywall_enabled: false,
        } }
      }
      if (url.includes('/api/sdk/flow/init')) return { status: 200, json: { action: 'authorized' } }
      if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.test/store/x' } }
      // upgrade-initiate: a refusal ends the call right after the request.
      return { status: 404, json: { detail: 'plan_not_purchasable' } }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { httpGet, BrandSource } from '@onelo/core'
import { OneloStore } from './store'
import { OneloElectronAuth } from './auth'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

function makeStore() {
  const auth = {
    brand: new BrandSource(),
    getSession: vi.fn(async () => SESSION),
    presentHostedUrl: vi.fn(async () => SESSION),
  }
  return new OneloStore('https://api.example.com', 'onelo_pk_test', auth as any, 'MyApp')
}

function langSentTo(path: string): string | null {
  const call = (httpGet as any).mock.calls.find((c: unknown[]) => new URL(c[0] as string).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return new URL(call[0] as string).searchParams.get('lang')
}

beforeEach(() => {
  ;(httpGet as any).mockClear()
  vi.stubGlobal('navigator', { language: 'de-DE' })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Store (store-initiate)', () => {
  it('sends the device language when the App passes none', async () => {
    await makeStore().initiateStoreFlow()
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await makeStore().initiateStoreFlow('pt-BR')
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('pt-BR')
  })

  it('opens the browser store in the device language too', async () => {
    await makeStore().openInBrowser()
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('de-DE')
  })
})

describe('Upgrade (upgrade-initiate)', () => {
  it('sends the device language when the App passes none', async () => {
    await makeStore().openUpgrade('pro').catch(() => {})
    expect(langSentTo('/api/sdk/paywall/upgrade-initiate')).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await makeStore().openUpgrade('pro', 'pl').catch(() => {})
    expect(langSentTo('/api/sdk/paywall/upgrade-initiate')).toBe('pl')
  })
})

describe('Sign-in (flow/init)', () => {
  it('sends the device language', async () => {
    const auth = new OneloElectronAuth({ apiUrl: 'https://api', publishableKey: 'onelo_pk_test', protocol: 'turingo' })
    await auth.whenReady(2)
    await (auth as unknown as { resolveFlow(): Promise<unknown> }).resolveFlow()
    expect(langSentTo('/api/sdk/flow/init')).toBe('de-DE')
  })
})
