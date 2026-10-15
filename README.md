# @onelo/electron

The Onelo SDK for Electron desktop apps.

Part of [Onelo](https://onelo.tools): hosted sign-in, a paywall on **your own Stripe** account, plan-gated feature flags, uptime monitoring, in-app feedback, a public roadmap and a waitlist — one SDK, wired together.

## Install

```bash
npm install github:onelo-tools/onelo-electron#semver:*
```

## Quick start

The SDK runs in the **main process**. Register your custom URL scheme before the app is ready, then create the client:

```ts
import { app, BrowserWindow } from 'electron'
import { Onelo } from '@onelo/electron'

// Must run before app is ready
app.setAsDefaultProtocolClient('myapp')

const onelo = new Onelo({
  publishableKey: 'onelo_pk_live_YOUR_KEY',
  apiUrl: 'https://api.onelo.tools',
  protocol: 'myapp',
  bundleId: 'com.company.app',
})

const auth = onelo.auth
```

`publishableKey` and `apiUrl` are both required — the SDK throws at construction if either is missing. Your Onelo dashboard shows the snippet with your values already filled in.

### Gate the app behind sign-in

Create the main window hidden, and only show it once the user is allowed in:

```ts
let mainWindow: BrowserWindow | null = null

async function enforceGate() {
  await auth.whenReady().catch(() => {})

  if (await auth.isAllowedIn()) {
    mainWindow?.show()
    return
  }

  mainWindow?.hide()
  // Pass null — not the main window — so auth appears as a standalone window
  await auth.presentAuthWindow(null)

  if (await auth.isAllowedIn()) mainWindow?.show()
}

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({ show: false })
  mainWindow.loadFile('index.html')
  await enforceGate()
})

// Re-run the gate whenever the session changes
auth.onSessionChange(() => { void enforceGate() })

// Complete flows that return through the system browser
app.on('open-url', (_e, url) => { auth.handleDeepLink(url).catch(() => {}) })
```

Two rules worth calling out, because getting them wrong is the usual source of trouble:

- **Pass `null` to `presentAuthWindow`**, not your main window, so auth appears as a standalone window.
- **Create the main window with `show: false`** and call `mainWindow.show()` only after sign-in.

A magic link from the hosted sign-in can be opened on another device: it shows a code there, and the sign-in window completes once the code is typed. Opened on this computer, it returns through your protocol handler. On Windows and Linux, pass a deep link from `process.argv` or `second-instance` to `handleDeepLink` before you call `presentAuthWindow`, because a new sign-in replaces the verifier that link needs.

## Modules

Everything below hangs off the one `onelo` instance.

| Accessor | What it does | Key methods |
|---|---|---|
| `onelo.auth` | Hosted sign-in, sessions, magic links, deep links | `presentAuthWindow()`, `isAllowedIn()`, `onSessionChange()`, `handleDeepLink()`, `sendMagicLink()`, `resendVerificationEmail()`, `confirmEmail()`, `getSignupMarketingConsent()`, `signOut()` |
| `onelo.features` | Plan-gated feature flags, pushed live | `feature()`, `isEnabled()`, `subscribe()`, `refresh()` |
| `onelo.monitor` | Error and event reporting | `capture()`, `event()`, `breadcrumb()`, `flush()` |
| `onelo.store` | Your hosted store, on your own Stripe | `open()`, `openUpgrade()`, `openInBrowser()` |
| `onelo.customerPortal` | Cancel, change plan, refunds, invoices | `open()`, `initiate()` |
| `onelo.feedback` | In-app bug reports and feature requests | `open()` |
| `onelo.forms` | Form submissions | `submit()` |
| `onelo.waitlist` | Pre-launch signups | `join()` |
| `onelo.consent` | Versioned terms / privacy consent gate | `presentGateIfNeeded()`, `requiredConsents()`, `acceptConsent()` |

Top-level helpers: `openUpgrade(plan, lang?)`, `destroy()`. Onelo requires Onelo Auth: signing in sets the user for every module, so the app does not call `identify()`.

`identify()` and its `userIdHash` argument are deprecated: the signed-in Onelo user is used automatically, and Features calls prove that user with their access token.

## Showing gated UI at startup

Wait for the current user's feature snapshot before you show gated UI. `getSession()` restores the stored user; `features.ready()` resolves once that user's snapshot is confirmed, or after the timeout (the snapshot saved on disk stays in use, and `subscribe()` fires when confirmation arrives). Await `ready()` again after every sign-in, sign-out or user switch.

```ts
await onelo.auth.getSession()
await onelo.features.ready(1500)
createMainWindow() // gated UI now reads the current user's features
```

## Talking to the renderer

Because the SDK lives in the main process, forward what the UI needs over IPC. `features.subscribe()` fires after the cache updates, so wire it to `webContents.send`:

```ts
onelo.features.subscribe(() => {
  mainWindow?.webContents.send('my-app:features-changed')
})
```

Feature updates arrive over a live stream, with polling only as a fallback — so the renderer re-renders as soon as you deploy a change.

The package also exports `IPC_CHANNELS`, a set of ready-made channel names for the auth calls a renderer typically needs: `GET_SESSION`, `SIGN_IN`, `SIGN_OUT`, `REFRESH_SESSION` and `OPEN_AUTH_URL`.

## Sign-in is always hosted

`presentAuthWindow()` and `loadAuthView()` always open the Onelo-hosted sign-in page, on every plan. There is no inline form to configure and no intermediate screen — the hosted page opens as soon as the SDK is ready, and carries your branding.

## Requirements

- Electron **28 or newer** (declared as a peer dependency)
- Ships prebuilt CommonJS output plus TypeScript declarations

## Links

- **Docs:** [onelo.tools/docs](https://onelo.tools/docs)
- **Dashboard:** [onelo.tools](https://onelo.tools) — your app's snippet comes pre-filled with your keys
- **Issues:** please report them on this repository

## License

MIT
