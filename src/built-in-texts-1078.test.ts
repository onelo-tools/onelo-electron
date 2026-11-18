/**
 * #1078 — the Electron SDK's own texts (sign-in error screen, window titles,
 * feedback error screen, feature badges) are in the App User's Page Language:
 * the one `/api/sdk/config` answers (`page_language`, chosen by the backend
 * from the App's language, else the device language, within the App
 * Languages). English until the first answer; the developer's content (app
 * name, plan names) is shown as written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const windows: Array<{ opts: Record<string, unknown>; loadURL: ReturnType<typeof vi.fn> }> = []

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    const win = {
      opts,
      loadURL: vi.fn(async () => {}),
      on: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      setMenuBarVisibility: vi.fn(),
      webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn(), executeJavaScript: vi.fn(async () => {}), getURL: vi.fn(() => '') },
    }
    windows.push(win)
    return win
  }),
  shell: { openExternal: vi.fn(async () => true) },
  app: { getPreferredSystemLanguages: () => ['fr-FR', 'en-GB', 'pl'], on: vi.fn() },
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
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 's', supabase_anon_key: 'a', tenant_id: 't',
          allow_custom_branding: false, oauth_providers: [], paywall_enabled: false,
          ...configAnswer,
        } }
      }
      if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.test/store/x' } }
      if (url.includes('/consent/required')) return { status: 200, json: { required: [] } }
      if (url.includes('/feedback/initiate')) throw new Error('offline')
      return { status: 404, json: {} }
    }),
    httpPost: vi.fn(async () => ({ status: 200, json: {} })),
  }
})

import { httpGet, BrandSource } from '@onelo/core'
import { OneloElectronAuth, flowErrorHtml } from './auth'
import { brandErrorPageHtml } from './brand-chrome'
import { FeatureState } from './features'
import { OneloFeedback } from './feedback'
import { OneloFeatures } from './features'
import { OneloStore } from './store'
import { OneloConsent } from './consent'
import { OneloWaitlist } from './waitlist'
import { OneloElectronCustomerPortal } from './customer-portal'
import {
  ONELO_TEXTS,
  PAGE_LANGUAGES,
  PAGE_LANGUAGE_STORAGE_KEY,
  acceptLanguage,
  adoptPageLanguage,
  oneloText,
  pageLanguage,
  resetPageLanguageForTest,
  type OneloTextKey,
} from './text'

const SESSION = {
  accessToken: 'tok', refreshToken: 'r', expiresAt: 9e9,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'active' },
}

function configCall(): { url: URL; headers: Record<string, string> } {
  const call = (httpGet as any).mock.calls.find((c: unknown[]) => (c[0] as string).includes('/api/sdk/config'))
  if (!call) throw new Error('no /api/sdk/config request')
  return { url: new URL(call[0] as string), headers: call[1] as Record<string, string> }
}

function langSentTo(path: string): string | null {
  const call = (httpGet as any).mock.calls.find((c: unknown[]) => new URL(c[0] as string).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return new URL(call[0] as string).searchParams.get('lang')
}

async function readyAuth(language?: string): Promise<OneloElectronAuth> {
  const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test', language })
  await (auth as any).initPromise
  return auth
}

beforeEach(() => {
  resetPageLanguageForTest()
  kept.clear()
  configAnswer = {}
  windows.length = 0
  ;(httpGet as any).mockClear()
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the table', () => {
  const keys = Object.keys(ONELO_TEXTS.en) as OneloTextKey[]

  it('has every built-in text in en, pl, de, fr, es, it, pt and nl', () => {
    expect(Object.keys(ONELO_TEXTS).sort()).toEqual([...PAGE_LANGUAGES].sort())
    for (const lang of PAGE_LANGUAGES) {
      expect(Object.keys(ONELO_TEXTS[lang]).sort()).toEqual([...keys].sort())
      for (const key of keys) expect(ONELO_TEXTS[lang][key].trim()).not.toBe('')
    }
  })

  it('keeps the plan placeholder in every language', () => {
    for (const lang of PAGE_LANGUAGES) expect(ONELO_TEXTS[lang].badgeAvailableIn).toContain('{plan}')
  })

  it('translates the sentences (not English copies) and German says "Sie"', () => {
    for (const lang of PAGE_LANGUAGES.filter((l) => l !== 'en')) {
      expect(ONELO_TEXTS[lang].signInFailedMessage).not.toBe(ONELO_TEXTS.en.signInFailedMessage)
      expect(ONELO_TEXTS[lang].tryAgain).not.toBe(ONELO_TEXTS.en.tryAgain)
    }
    expect(ONELO_TEXTS.de.signInFailedMessage).toMatch(/\bSie\b/)
  })

  it('falls back to English for a language Onelo does not translate into', () => {
    expect(oneloText('tryAgain', {}, 'ja')).toBe('Try again')
    expect(oneloText('tryAgain', {}, 'pt-PT')).toBe('Tentar novamente')
  })
})

describe('the Page Language comes from /api/sdk/config', () => {
  it('is English until the first answer', async () => {
    expect(pageLanguage()).toBe('en')
    const auth = await readyAuth()
    expect(auth.pageLanguage).toBe('en')
    expect(flowErrorHtml()).toContain('Couldn&#39;t start sign-in')
  })

  it('adopts the answer: the sign-in error screen and its button speak it', async () => {
    configAnswer = { page_language: 'pl' }
    const auth = await readyAuth()
    expect(auth.pageLanguage).toBe('pl')
    const html = flowErrorHtml()
    expect(html).toContain('Nie udało się rozpocząć logowania')
    expect(html).toContain(ONELO_TEXTS.pl.signInFailedMessage)
    expect(html).toContain('>Spróbuj ponownie</button>')
    expect(html).toContain('<html lang="pl">')
  })

  it('asks with the App language when given, else the device language, plus Accept-Language', async () => {
    await readyAuth('nl')
    expect(configCall().url.searchParams.get('lang')).toBe('nl')
    expect(configCall().headers['Accept-Language']).toBe('fr-FR, en-GB;q=0.9, pl;q=0.8')
    ;(httpGet as any).mockClear()
    await readyAuth()
    expect(configCall().url.searchParams.get('lang')).toBe('de-DE')
  })

  it('a missing or null answer keeps the current language', async () => {
    adoptPageLanguage('de')
    configAnswer = { page_language: null }
    const auth = await readyAuth()
    expect(auth.pageLanguage).toBe('de')
  })

  it('keeps the answer for the next launch and paints with it before config answers', async () => {
    configAnswer = { page_language: 'it' }
    await readyAuth()
    expect(kept.get(PAGE_LANGUAGE_STORAGE_KEY)).toBe('it')

    resetPageLanguageForTest()
    configAnswer = {} // an older backend this time: the kept language stays
    const auth = await readyAuth()
    expect(auth.pageLanguage).toBe('it')
  })

  it('reduces a regional answer to its language', () => {
    expect(adoptPageLanguage('pt-PT')).toBe('pt')
    expect(adoptPageLanguage('')).toBeNull()
    expect(adoptPageLanguage(42)).toBeNull()
    expect(pageLanguage()).toBe('pt')
  })

  it('builds Accept-Language from preferred tags', () => {
    expect(acceptLanguage(['pl-PL', 'pl-PL', 'en', '*'])).toBe('pl-PL, en;q=0.9')
    expect(acceptLanguage([])).toBeNull()
  })
})

describe('window titles', () => {
  it('the sign-in window shows "Sign in" in the Page Language while no App name is known', async () => {
    adoptPageLanguage('es')
    const auth = new OneloElectronAuth({ apiUrl: 'https://api.example.com', publishableKey: 'onelo_pk_test' })
    expect((auth as any).windowTitle()).toBe('Iniciar sesión')
    auth.appName = 'Acme Notes' // the developer's name, as written
    expect((auth as any).windowTitle()).toBe('Acme Notes')
  })

  it('the store window is titled in the Page Language', async () => {
    adoptPageLanguage('pl')
    const auth = { brand: new BrandSource(), getSession: vi.fn(async () => SESSION), presentHostedUrl: vi.fn(async () => SESSION) }
    await new OneloStore('https://api.example.com', 'onelo_pk_test', auth as any, 'myapp').open()
    expect((auth.presentHostedUrl.mock.calls[0] as unknown[])[2]).toBe('Sklep')
  })

  it('the feedback window title and its error screen speak the Page Language', async () => {
    adoptPageLanguage('de')
    const feedback = new OneloFeedback({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.example.com' }, new OneloFeatures('onelo_pk_test', 'https://api.example.com'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(feedback as any, '_initiate').mockRejectedValue(new Error('offline'))
    feedback.open()
    await vi.waitFor(() => expect(windows[0]?.loadURL.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(windows[0].opts.title).toBe('Feedback senden')
    const errorPage = decodeURIComponent(String(windows[0].loadURL.mock.calls.at(-1)?.[0]))
    expect(errorPage).toContain('Feedback konnte nicht geladen werden')
    expect(errorPage).toContain(ONELO_TEXTS.de.connectionProblem)
    expect(errorPage).toContain('>Erneut versuchen</button>')
    // The technical reason is the developer's, in the console.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'))
    warn.mockRestore()
  })

  it('a refused feedback form says "Something went wrong" in the Page Language, the status goes to the console', async () => {
    adoptPageLanguage('nl')
    const feedback = new OneloFeedback({ publishableKey: 'onelo_pk_test', apiUrl: 'https://api.example.com' }, new OneloFeatures('onelo_pk_test', 'https://api.example.com'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(feedback as any, '_initiate').mockResolvedValue({ ok: false, status: 503 })
    feedback.open()
    await vi.waitFor(() => expect(windows[0]?.loadURL.mock.calls.length).toBeGreaterThanOrEqual(2))
    const errorPage = decodeURIComponent(String(windows[0].loadURL.mock.calls.at(-1)?.[0]))
    expect(errorPage).toContain('Feedback kon niet worden geladen')
    expect(errorPage).toContain('Er is iets misgegaan. Probeer het opnieuw.')
    expect(errorPage).not.toContain('503')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'))
    warn.mockRestore()
  })

  it('the customer portal and consent windows are titled in the Page Language', async () => {
    adoptPageLanguage('it')
    const auth = { brand: new BrandSource(), getSession: vi.fn(async () => SESSION) }
    void new OneloElectronCustomerPortal('https://api.example.com', 'onelo_pk_test', auth as any, 'myapp')
      .presentUrl('https://api.example.com/customer/portal/x')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    void (new OneloConsent('https://api.example.com', 'onelo_pk_test', auth as any) as any)
      ._presentConsentWindow({ url: 'https://api.example.com/legal/terms' })
    await vi.waitFor(() => expect(windows.length).toBe(2))
    expect(windows.map((w) => w.opts.title).sort()).toEqual(['Esamina e accetta', 'Gestisci account'])
    warn.mockRestore()
  })

  it('an explicit button label is shown as passed', () => {
    adoptPageLanguage('fr')
    const html = brandErrorPageHtml(new BrandSource().current(), { title: 't', message: 'm', retryHref: 'x://y', buttonLabel: 'Go' })
    expect(html).toContain('>Go</button>')
  })
})

describe('feature badges', () => {
  it('speak the Page Language and show the plan name as written', () => {
    adoptPageLanguage('pl')
    expect(new FeatureState('a', 'new').badgeLabel).toBe('Nowość')
    expect(new FeatureState('a', 'beta').badgeLabel).toBe('Beta')
    expect(new FeatureState('a', 'coming_soon').badgeLabel).toBe('Wkrótce')
    expect(new FeatureState('a', 'upsell', 'plan', 'pro', 'Pro Max').badgeLabel).toBe('Dostępne w planie Pro Max')
    expect(new FeatureState('a', 'upsell', 'plan', 'pro').badgeLabel).toBe('Dostępne w planie pro')
    expect(new FeatureState('a', 'upsell').badgeLabel).toBe('Zmień plan')
    expect(new FeatureState('a', 'greyed').badgeLabel).toBe('🔒')
    expect(new FeatureState('a', 'enabled').badgeLabel).toBeNull()
    // The IPC snapshot carries the translated badge too.
    expect(new FeatureState('a', 'coming_soon').toJSON().badgeLabel).toBe('Wkrótce')
  })

  it('keep their English words in English', () => {
    expect(new FeatureState('a', 'coming_soon').badgeLabel).toBe('Coming soon')
    expect(new FeatureState('a', 'upsell', 'plan', 'pro', 'Pro').badgeLabel).toBe('Available in Pro')
    expect(new FeatureState('a', 'upsell').badgeLabel).toBe('Change plan')
  })
})

// The hosted pages' dictionaries, read as text: the published SDK repository
// has no frontend/, so the pin is skipped there.
const FRONTEND_LIB = join(__dirname, '..', '..', '..', 'frontend', 'lib')
const hasFrontend = existsSync(join(FRONTEND_LIB, 'hosted-notice-i18n.ts')) && existsSync(join(FRONTEND_LIB, 'store-i18n.ts'))

/** `field`'s string value in each locale block (`  en: {` …) of a dictionary file. */
function wordsByLocale(file: string, field: string): Record<string, string> {
  const src = readFileSync(join(FRONTEND_LIB, file), 'utf-8')
  const out: Record<string, string> = {}
  const blocks = src.split(/\n  (en|pl|de|fr|es|it|pt|nl): \{\n/)
  for (let i = 1; i < blocks.length; i += 2) {
    const m = blocks[i + 1].match(new RegExp(`\\b${field}: (?:\\(plan\\) => )?(['"\`])(.*?)\\1`))
    if (m) out[blocks[i]] = m[2].replace('${plan}', '{plan}')
  }
  return out
}

describe.skipIf(!hasFrontend)('badge words are the hosted pages\' own', () => {
  it('Coming soon and Available in <plan> match hosted-notice-i18n.ts; the upsell fallback is the Store\'s changePlan', () => {
    const comingSoon = wordsByLocale('hosted-notice-i18n.ts', 'lockComingSoon')
    const availableIn = wordsByLocale('hosted-notice-i18n.ts', 'lockAvailableIn')
    const changePlan = wordsByLocale('store-i18n.ts', 'changePlan')
    for (const lang of PAGE_LANGUAGES) {
      expect(ONELO_TEXTS[lang].badgeComingSoon, lang).toBe(comingSoon[lang])
      expect(ONELO_TEXTS[lang].badgeAvailableIn, lang).toBe(availableIn[lang])
      expect(ONELO_TEXTS[lang].badgeUpgrade, lang).toBe(changePlan[lang])
    }
  })
})

describe('the App language is the default lang of every Page Language request', () => {
  function fakeAuth(language?: string) {
    return { brand: new BrandSource(), language, getSession: vi.fn(async () => SESSION), presentHostedUrl: vi.fn(async () => SESSION) }
  }

  it('store-initiate sends the App language; a language passed to the call wins', async () => {
    const store = new OneloStore('https://api.example.com', 'onelo_pk_test', fakeAuth('fr') as any, 'myapp')
    await store.initiateStoreFlow()
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('fr')
    ;(httpGet as any).mockClear()
    await store.initiateStoreFlow('it')
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('it')
  })

  it('consent/required sends the App language, else the device language', async () => {
    await new OneloConsent('https://api.example.com', 'onelo_pk_test', fakeAuth('es') as any).requiredConsents()
    expect(langSentTo('/v1/sdk/consent/required')).toBe('es')
    ;(httpGet as any).mockClear()
    await new OneloConsent('https://api.example.com', 'onelo_pk_test', fakeAuth() as any).requiredConsents()
    expect(langSentTo('/v1/sdk/consent/required')).toBe('de-DE')
  })

  it('flow/init sends the App language', async () => {
    const auth = await readyAuth('pt-PT')
    ;(httpGet as any).mockClear()
    await (auth as any).resolveFlow().catch(() => {})
    expect(langSentTo('/api/sdk/flow/init')).toBe('pt-PT')
  })

  it('waitlist join sends the App language; the join option wins', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ ok: true }) }
    }))
    const waitlist = new OneloWaitlist('https://api.example.com', 'onelo_pk_test', undefined, 'nl')
    await waitlist.join(undefined, 'a@b.com')
    await waitlist.join(undefined, 'a@b.com', { language: 'pl' })
    expect(bodies.map((b) => b.language)).toEqual(['nl', 'pl'])
  })
})
