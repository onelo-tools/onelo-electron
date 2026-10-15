# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.61.1] — 2026-10-07

### Fixed

- Feature snapshots are bound to the identity that requested them (#735, parity with Swift and `@onelo/js` #734). A late answer for a previous user or an anonymous answer (including an anonymous-fallback stream after a refused token) never replaces the signed-in user's snapshot. `features.ready()` resets on every sign-in, sign-out or user switch and resolves only once the current identity's snapshot is confirmed. `since_version` stays 0 until the current identity confirms a version. The first Features load waits for the stored session to be restored, so a returning user never gets an anonymous first snapshot.

## [0.61.0-staging] — 2026-10-03

### Added

- Marketing Consent for your own screens (#818). `auth.getSignupMarketingConsent()` (`asked`, `text`, `language`) tells a custom sign-up screen whether to show the optional checkbox and with what text, from `/api/sdk/config` asked in the device language. `signUp(email, password, { marketingConsent })` sends the consent (and its language) only when ticked. `waitlist.join(slug, email, { consent: { marketing, custom } })`.

## [0.60.0-staging] — 2026-10-03

### Added

- Email Verification (#819). `OneloUser` carries `emailVerified` and `accessReason` (`'email_unverified'` when the app is withheld for it); `isAllowedIn()` is false until the user opens the link, and the hosted window shows "check your inbox" with resend and hands the session back. New `auth.resendVerificationEmail({ redirectTo? })` and `auth.confirmEmail(token)` for apps with their own screen; new error codes `verification_rate_limited`, `email_verification_off`, `invalid_verification_token`, `invalid_verify_redirect`. `confirmEmail()` refreshes the signed-in session so the app opens at once; `revalidateEntitlement()` refreshes `allowedIn`, `emailVerified` and `accessReason` together.

## [0.59.0-staging] — 2026-10-03

### Added

- A signed-in user's feedback report names a verified reporter (#820). With an Onelo Auth session, `feedback.open()` sends the user's access token (`Authorization: Bearer`) on `/api/sdk/feedback/initiate`; Onelo stores the report with that user and `reporter_verified=true`, so no `userId` is needed. A refused token is refreshed and retried once; refused again, the form still opens without it. Signed out, the report stays anonymous; an explicit `userId` without a session is still an unverified label.

## [0.58.0-staging] — 2026-10-01

### Added

- A magic link from the hosted sign-in can be opened on another device (#542, server side #540). The hosted flow now sends a PKCE `code_challenge` on `/api/sdk/flow/init`, with its verifier kept in safeStorage. Opened on another device, the link shows a code there; once it is typed, the sign-in window completes on its own. Opened on this computer, it returns through `open-url` / `second-instance` → `handleDeepLink`, which settles the waiting sign-in window, also after a relaunch: the code is exchanged with the stored verifier. The verifier is single use and is cleared on sign-out.

### Fixed

- The in-window `<scheme>://callback?code=` navigation is now blocked. Before, the OS protocol handler could deliver it a second time, and that second exchange failed on the already-used code.

### Changed

- A link that belongs to a different sign-in on this computer fails with a clear message, in one attempt with no retry.
- Custom-UI `sendMagicLink()` is unchanged and unpaired: open that link on the same computer.

## [0.57.1-staging] — 2026-10-01

### Fixed

- `waitlist.join()` reports a successful signup as `success: true` (#697). It read a `success` field the backend never sends, so every join — new or already on the list — came back as `success: false`. It now follows the endpoint's real response: HTTP 2xx with `ok: true` is success, carrying `position` and `alreadyJoined`; a non-2xx response or a body without `ok: true` is a failure.

## [0.57.0-staging] — 2026-09-29

### Changed

- SDK chrome is painted from the app's Branding (#681): the "Couldn't start sign-in" / "Couldn't load feedback" error pages (ground, text, "Try again" button colours and radius, font), the portal and feedback skeletons and every window's background come from `brand_tokens` (`/api/sdk/config`, refreshed by store / portal / upgrade initiate). Older backend → the legacy colour fields; before config → neutral, never Onelo orange. New exported type `BrandTokens`.

## [0.56.0-staging] — 2026-09-29

### Fixed

- After a purchase or a plan switch in the store (auth window, portal window, or the system browser via `handleDeepLink`), the app shows the new plan at once instead of waiting for the Event Stream (#659). Every successful hand-back forces a features re-resolve and re-reads the entitlement; a `plan_switch_pending` switch is re-checked after 1, 2, 4, 8 and 15 s until the features change. One refresher (`plan-change.ts`), wired by `Onelo`.
- The existing `paywall.access_changed` listener now fires (#635): the backend forwards this per-user frame on the Event Stream (it used to stay server-internal), so `hasActiveAccess` follows a plan change live.

## [0.55.0-staging] — 2026-09-28

### Fixed

- A store window whose link died (#619) now reopens on a fresh link from `store-initiate` instead of re-resolving `/flow/init`. `presentHostedUrl` takes an optional renewal supplier for the surface it shows; `store.open()` passes its own initiate. A link that cannot be minted closes the window, as before.
## [0.54.0-staging] — 2026-09-28

### Added

- The feedback window (`feedback.open()`) now keeps the reporter when the form was left open longer than its 30-minute reporter token (#622). On submit the hosted form asks the SDK for a fresh token (`onelo:renew_request`, kind `feedback`); the SDK calls `/api/sdk/feedback/initiate` again with the same options and hands the new form URL back, and the report is sent with its reporter. Before, such a report was stored without a reporter and nobody was told.

## [0.53.0-staging] — 2026-09-28

### Added

- `customerPortal.open(parentWindow, { intent: 'change_plan' })` and `customerPortal.openInBrowser({ intent: 'change_plan' })` open the portal straight into the plan picker, the same as `@onelo/js` (#606). The hosted portal asks the backend where the change goes. The `PortalIntent` type is exported.

### Changed

- `openUpgrade(plan, lang, parentWindow?)` opens the upgrade in the SDK's portal window instead of the system browser (#606). The store's hand-back (a purchase, a plan switch, or "Return to app" on a spent link) closes the window. The promise resolves when it closes. A store built without `Onelo` still uses the system browser.
- The portal window re-reads the entitlement when it closes, so `hasActiveAccess()` reflects a plan bought or changed there (#606).
- The portal window also closes on `<scheme>://callback?error=…` (a spent store link) instead of handing it to the OS (#606).

## [0.52.0-staging] — 2026-09-28

### Changed

- One decoder for every `<scheme>://callback` hand-back (#615): the store/auth window and the Customer Portal window classify `?code=`, `?source=store&event=…`, `?source=portal[&event=…]` and `?error=` through the same function. A paid plan switch still being updated after the store's wait (`event=plan_switch_pending`) closes the window as a success; the new plan arrives over the Event Stream.

## [0.51.0-staging] — 2026-09-28

### Added

- The Customer Portal window renews an expired portal token instead of showing "Link expired" to a signed-in user (#613 / #614). A relay injected into each page turns the page's `onelo:renew_request` into a `<scheme>://renew-portal?request_id=…` navigation the window intercepts; the SDK mints a fresh portal with the current session and posts the reply into the page. New `customerPortal.renewReply(requestId)`.

## [0.50.0-staging] — 2026-09-28

### Fixed

- After a month↔year plan switch or a scheduled downgrade, the store window (`store.open()` / `presentAuthWindow()`) and the Customer Portal window close by themselves (#599). The hosted store reports these code-less finishes as `<scheme>://callback?source=store&event=plan_switched|switch_scheduled`; the store window resolves with the current session instead of rejecting "did not return a session", and the scheme URL never reaches the OS.

## [0.49.1-staging] — 2026-09-27

### Fixed

- `customerPortal.open()`: a purchase started from the portal ("Change plan", "View plans", upgrade) now closes the portal window after the store's success screen (#592). Previously the store's `<scheme>://callback?code=` hand-back was not intercepted, so the window stayed open and the scheme URL could reach the OS. The new plan arrives over the live entitlement stream.

## [0.49.0-staging] — 2026-09-26

### Changed

- A refused session refresh now says what happened (#548). `session_compromised`, `session_expired` and `session_invalid` end the session with the neutral `OneloError` code `session_ended` ("Your session ended — please sign in again"). Only `banned` says "suspended" and sets `isUserRevoked`. `no_plan_available` stays `no_active_plan`.
- `refreshSession()` now throws `session_ended` for an expired or invalid session instead of resolving `null`. `getSession()` still answers `null` for every ended session and never throws for it, and the heartbeat no longer lets a failed refresh escape as an unhandled rejection.
- Uncaught errors captured by Monitor carry `meta.origin` (`onelo_sdk` or `app`).
- A transient refresh failure — offline, a lost response, `429`, or a `5xx` including the new `503 refresh_unavailable` — no longer signs the user out. The session is kept and the refresh is retried after 5 s, 10 s, 20 s, 40 s, then every 60 s.

## [0.48.0-staging] — 2026-09-25

### Changed

- Features calls now prove the signed-in user with the Onelo access token (#518). Resolve, batch-ping, poll, module-token and the Event Stream send `Authorization: Bearer <access token>`, read fresh for every call and every reconnect. A refused token (`401 invalid_user_token`) is refreshed and retried once; if it is refused again, that call is made without a user and a warning is logged.
- `userIdHash` is no longer sent. `identify()` and its `userIdHash` argument still compile but are deprecated: the signed-in Onelo user is used automatically.
