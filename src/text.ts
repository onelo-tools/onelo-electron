/**
 * #1078 — the language this SDK's own texts are drawn in: the App's **Page
 * Language** (ADR-0043). The order is the language the App passes
 * (`OneloElectronConfig.language`) when it is one of the App Languages, else
 * the device language when it is one, else the App's default — the same
 * language as the Hosted Pages.
 *
 * The SDK never chooses it. `/api/sdk/config` is asked with the App's language
 * (or the device language) plus the device's preferred languages as
 * `Accept-Language`, and answers `page_language`, chosen in Python
 * (`app.lib.page_language`, #1074). The SDK adopts that answer, keeps it for
 * the next launch's first paint, and renders. Until a first answer arrives
 * (and with nothing kept from an earlier launch) the texts are English: the
 * language every App starts with. A backend that omits the field (or answers
 * `null`) leaves the language as it was.
 *
 * One value per process: a `FeatureState`'s badge has no SDK instance to ask.
 * An app that builds two `Onelo` instances gets the latest answer. Parity with
 * Swift `OneloPageLanguage` (#1074) and Android (#1075).
 */
import { adoptPageLanguage as adoptCorePageLanguage, deviceLanguage, resetPageLanguageForTest as resetCorePageLanguage } from '@onelo/core'

/** The languages Onelo translates its own texts into (`SUPPORTED_LANGUAGES` in
 *  `backend/app/lib/app_languages.py`). `pt` is European Portuguese. */
export const PAGE_LANGUAGES = ['en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl'] as const

/** SecureTokenStorage key of the last adopted answer (next launch's first paint). */
export const PAGE_LANGUAGE_STORAGE_KEY = 'onelo_page_language'

let current = 'en'

/** The Page Language the SDK's texts are drawn in now. */
export function pageLanguage(): string {
  return current
}

/** The primary subtag of a language tag (`pl-PL` → `pl`), or null when the
 *  value is no language tag. */
export function primarySubtag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : null
}

/**
 * Adopt the Page Language the backend answered. Returns the adopted value, or
 * null (nothing changes) when the answer is missing or no language tag.
 */
export function adoptPageLanguage(answer: unknown): string | null {
  const primary = primarySubtag(answer)
  if (!primary) return null
  current = primary
  adoptCorePageLanguage(primary) // #1079: `OneloError` messages (@onelo/core) follow it too
  return primary
}

/** Back to the state of a fresh process. Tests only. */
export function resetPageLanguageForTest(): void {
  current = 'en'
  resetCorePageLanguage()
}

/**
 * The language a Page Language request sends: the one passed for this call,
 * else the App's (`OneloElectronConfig.language`), else the device language
 * (#1039). The backend picks the Page Language within the App Languages.
 */
export function requestLanguage(passed?: string | null, appLanguage?: string | null): string {
  return passed ?? (appLanguage || deviceLanguage())
}

/**
 * The device's preferred languages as an `Accept-Language` value
 * (`pl-PL, en;q=0.9, …`): the backend's next choice when the language asked
 * with (the App's, or the device's first) is not one the App offers. Electron's
 * `app.getPreferredSystemLanguages()`, else the runtime's `navigator.languages`;
 * null when neither can say.
 */
export async function deviceAcceptLanguage(): Promise<string | null> {
  let tags: string[] = []
  try {
    const { app } = await import('electron')
    const preferred = app?.getPreferredSystemLanguages?.()
    if (Array.isArray(preferred)) tags = preferred
  } catch {
    // Not in Electron's main process (or a test double without `app`).
  }
  if (tags.length === 0) {
    try {
      const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator
      tags = [...(nav?.languages ?? (nav?.language ? [nav.language] : []))]
    } catch {
      tags = []
    }
  }
  return acceptLanguage(tags)
}

/** `Accept-Language` from language tags, most preferred first (at most six). */
export function acceptLanguage(tags: readonly string[]): string | null {
  const usable = [...new Set(tags.filter((t) => primarySubtag(t) !== null).map((t) => t.trim()))].slice(0, 6)
  if (usable.length === 0) return null
  return usable
    .map((tag, i) => (i === 0 ? tag : `${tag};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`))
    .join(', ')
}

/**
 * Every text this SDK draws itself, in the eight languages Onelo translates
 * into. A developer's own content (app name, plan names, their texts) is never
 * here: it is shown as written. Log lines and messages that address the
 * developer (an invalid key, a missing configuration, `OneloError` messages)
 * stay English. Badge, "Try again" and "Store" words are the hosted pages'
 * (frontend/lib/hosted-notice-i18n.ts, the Store's `changePlan`); the rest are
 * Swift's (#1074).
 */
export type OneloTextKey =
  // Window titles
  | 'signIn'
  | 'store'
  | 'reviewAndAccept'
  | 'manageAccount'
  | 'sendFeedback'
  // Error screens
  | 'tryAgain'
  | 'signInFailedTitle'
  | 'signInFailedMessage'
  | 'feedbackFailedTitle'
  | 'somethingWentWrong'
  | 'connectionProblem'
  // Feature badges (`FeatureState.badgeLabel`); {plan} is the plan name as written.
  // The words are the hosted pages' own: badgeComingSoon / badgeAvailableIn are
  // hosted-notice-i18n.ts lockComingSoon / lockAvailableIn, badgeUpgrade is
  // store-i18n.ts changePlan (pinned by built-in-texts-1078.test.ts).
  | 'badgeNew'
  | 'badgeBeta'
  | 'badgeComingSoon'
  | 'badgeAvailableIn'
  | 'badgeUpgrade'

type Table = Record<OneloTextKey, string>

export const ONELO_TEXTS: Record<(typeof PAGE_LANGUAGES)[number], Table> = {
  en: {
    signIn: 'Sign in',
    store: 'Store',
    reviewAndAccept: 'Review & Accept',
    manageAccount: 'Manage Account',
    sendFeedback: 'Send Feedback',
    tryAgain: 'Try again',
    signInFailedTitle: "Couldn't start sign-in",
    signInFailedMessage: 'Something went wrong while connecting. Please check your connection and try again.',
    feedbackFailedTitle: "Couldn't load feedback",
    somethingWentWrong: 'Something went wrong. Please try again.',
    connectionProblem: "Couldn't connect. Check your internet connection and try again.",
    badgeNew: 'New',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Coming soon',
    badgeAvailableIn: 'Available in {plan}',
    badgeUpgrade: 'Change plan',
  },
  pl: {
    signIn: 'Zaloguj się',
    store: 'Sklep',
    reviewAndAccept: 'Przejrzyj i zaakceptuj',
    manageAccount: 'Zarządzaj kontem',
    sendFeedback: 'Wyślij opinię',
    tryAgain: 'Spróbuj ponownie',
    signInFailedTitle: 'Nie udało się rozpocząć logowania',
    signInFailedMessage: 'Podczas łączenia coś poszło nie tak. Sprawdź połączenie i spróbuj ponownie.',
    feedbackFailedTitle: 'Nie udało się wczytać formularza opinii',
    somethingWentWrong: 'Coś poszło nie tak. Spróbuj ponownie.',
    connectionProblem: 'Nie udało się połączyć. Sprawdź połączenie z internetem i spróbuj ponownie.',
    badgeNew: 'Nowość',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Wkrótce',
    badgeAvailableIn: 'Dostępne w planie {plan}',
    badgeUpgrade: 'Zmień plan',
  },
  de: {
    signIn: 'Anmelden',
    store: 'Shop',
    reviewAndAccept: 'Prüfen und akzeptieren',
    manageAccount: 'Konto verwalten',
    sendFeedback: 'Feedback senden',
    tryAgain: 'Erneut versuchen',
    signInFailedTitle: 'Die Anmeldung konnte nicht gestartet werden',
    signInFailedMessage: 'Beim Verbinden ist etwas schiefgelaufen. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    feedbackFailedTitle: 'Feedback konnte nicht geladen werden',
    somethingWentWrong: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    connectionProblem: 'Keine Verbindung möglich. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
    badgeNew: 'Neu',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Demnächst verfügbar',
    badgeAvailableIn: 'Verfügbar im Plan {plan}',
    badgeUpgrade: 'Plan ändern',
  },
  fr: {
    signIn: 'Se connecter',
    store: 'Boutique',
    reviewAndAccept: 'Consulter et accepter',
    manageAccount: 'Gérer le compte',
    sendFeedback: 'Envoyer un avis',
    tryAgain: 'Réessayer',
    signInFailedTitle: 'Impossible de démarrer la connexion',
    signInFailedMessage: 'Un problème est survenu lors de la connexion. Vérifiez votre connexion Internet et réessayez.',
    feedbackFailedTitle: 'Impossible de charger le formulaire d’avis',
    somethingWentWrong: 'Une erreur s’est produite. Veuillez réessayer.',
    connectionProblem: 'Connexion impossible. Vérifiez votre connexion Internet et réessayez.',
    badgeNew: 'Nouveau',
    badgeBeta: 'Bêta',
    badgeComingSoon: 'Bientôt disponible',
    badgeAvailableIn: 'Disponible avec le plan {plan}',
    badgeUpgrade: 'Changer de plan',
  },
  es: {
    signIn: 'Iniciar sesión',
    store: 'Tienda',
    reviewAndAccept: 'Revisar y aceptar',
    manageAccount: 'Gestionar la cuenta',
    sendFeedback: 'Enviar comentarios',
    tryAgain: 'Volver a intentarlo',
    signInFailedTitle: 'No se ha podido iniciar sesión',
    signInFailedMessage: 'Algo ha salido mal al conectar. Comprueba tu conexión e inténtalo de nuevo.',
    feedbackFailedTitle: 'No se han podido cargar los comentarios',
    somethingWentWrong: 'Algo ha salido mal. Inténtalo de nuevo.',
    connectionProblem: 'No se ha podido conectar. Comprueba tu conexión a internet e inténtalo de nuevo.',
    badgeNew: 'Nuevo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Próximamente',
    badgeAvailableIn: 'Disponible en el plan {plan}',
    badgeUpgrade: 'Cambiar plan',
  },
  it: {
    signIn: 'Accedi',
    store: 'Negozio',
    reviewAndAccept: 'Esamina e accetta',
    manageAccount: 'Gestisci account',
    sendFeedback: 'Invia feedback',
    tryAgain: 'Riprova',
    signInFailedTitle: 'Impossibile avviare l’accesso',
    signInFailedMessage: 'Si è verificato un problema durante la connessione. Controlla la connessione e riprova.',
    feedbackFailedTitle: 'Impossibile caricare il feedback',
    somethingWentWrong: 'Si è verificato un problema. Riprova.',
    connectionProblem: 'Impossibile connettersi. Controlla la connessione a internet e riprova.',
    badgeNew: 'Novità',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Prossimamente',
    badgeAvailableIn: 'Disponibile nel piano {plan}',
    badgeUpgrade: 'Cambia piano',
  },
  pt: {
    signIn: 'Iniciar sessão',
    store: 'Loja',
    reviewAndAccept: 'Rever e aceitar',
    manageAccount: 'Gerir conta',
    sendFeedback: 'Enviar feedback',
    tryAgain: 'Tentar novamente',
    signInFailedTitle: 'Não foi possível iniciar sessão',
    signInFailedMessage: 'Ocorreu um erro ao estabelecer a ligação. Verifique a sua ligação e tente novamente.',
    feedbackFailedTitle: 'Não foi possível carregar o feedback',
    somethingWentWrong: 'Ocorreu um erro. Tente novamente.',
    connectionProblem: 'Não foi possível estabelecer ligação. Verifique a sua ligação à internet e tente novamente.',
    badgeNew: 'Novo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Brevemente',
    badgeAvailableIn: 'Disponível no plano {plan}',
    badgeUpgrade: 'Mudar de plano',
  },
  nl: {
    signIn: 'Inloggen',
    store: 'Winkel',
    reviewAndAccept: 'Bekijken en accepteren',
    manageAccount: 'Account beheren',
    sendFeedback: 'Feedback versturen',
    tryAgain: 'Opnieuw proberen',
    signInFailedTitle: 'Inloggen kon niet worden gestart',
    signInFailedMessage: 'Er ging iets mis bij het verbinden. Controleer je verbinding en probeer het opnieuw.',
    feedbackFailedTitle: 'Feedback kon niet worden geladen',
    somethingWentWrong: 'Er is iets misgegaan. Probeer het opnieuw.',
    connectionProblem: 'Kan geen verbinding maken. Controleer je internetverbinding en probeer het opnieuw.',
    badgeNew: 'Nieuw',
    badgeBeta: 'Bèta',
    badgeComingSoon: 'Binnenkort beschikbaar',
    badgeAvailableIn: 'Beschikbaar in het plan {plan}',
    badgeUpgrade: 'Plan wijzigen',
  },
}

/**
 * This text in `language` (default: the current Page Language), with
 * `{name}` placeholders filled in. English for a language Onelo does not
 * translate into.
 */
export function oneloText(key: OneloTextKey, fill: Record<string, string> = {}, language: string = current): string {
  const lang = primarySubtag(language) ?? 'en'
  const table = (ONELO_TEXTS as Record<string, Table | undefined>)[lang] ?? ONELO_TEXTS.en
  let text = table[key]
  for (const [name, value] of Object.entries(fill)) text = text.split(`{${name}}`).join(value)
  return text
}
