# Phase 8: Android app

**Goal:** the same client, installed on an Android phone as an app that talks to the API
over HTTPS, stays signed in, and unlocks with fingerprint or face after the first sign-in.

**Depends on:** phase 7. **Suggested model:** Sonnet for 8.1 to 8.3; Opus for 8.4 (token
handling and biometrics deserve the stronger reviewer).

## Approach

[Capacitor](https://capacitorjs.com) wraps the built client (`dist/client`) in a native
Android shell. The web code is unchanged apart from two seams that already exist:

- `VITE_API_BASE_URL` in `src/client/lib/api.ts`: empty on the web, the server's URL in
  the app build.
- How the session is carried: a cookie on the web; a bearer token in the app, because the
  app's pages are served from a local origin and cross-site cookies are unreliable there.

Going fully native (Kotlin/Compose) would mean writing every screen twice. Nothing in the
brief needs it; revisit only if the wrapped app feels wrong in daily use.

## Before starting

- A **current** Android Studio (it bundles the JDK), with SDK Platform 36 and Build-Tools
  36 installed through its SDK Manager; a Pixel with USB debugging on, or an API 36
  emulator. `HANDOFF.md` lists what was found on the development machine and what to
  install.
- The API reachable from the phone over **HTTPS** (a reverse proxy with a certificate, or a
  private network such as Tailscale with HTTPS enabled). Android blocks plain HTTP by
  default and the session cookie/token should never travel unencrypted.
- Capacitor was at 8.5 on 2026-10-10: Node 22+, JDK 21, compile and target SDK 36,
  minimum SDK 24. Check again before installing.

## Tasks

### 8.1 Bearer sessions and CORS on the API

- [x] Done

**Files:** `src/shared/auth.ts`, `src/server/services/auth.ts`, `src/server/routes/auth.ts`,
`src/server/middleware/session.ts`, `src/server/app.ts`, `src/server/env.ts`,
`.env.example`, `src/server/routes/auth.test.ts`.

- `register` and `login` accept an optional `transport: "cookie" | "token"` (default
  `cookie`). With `token`, set no cookie and return `{ user, token, expiresAt }`.
- `requireAuth` and `logout` accept `Authorization: Bearer <token>` as well as the cookie.
  If both are present the header wins.
- Sliding renewal for token sessions: when the session is extended, send the new expiry
  in an `X-Session-Expires` response header (the token itself doesn't change).
- Add `hono/cors` for `/api/*` allowing exactly the origins in `APP_ORIGINS`, with
  credentials, the `Authorization` and `Content-Type` headers, and `X-Session-Expires`
  exposed. Document adding the app's origin (`https://localhost` for Capacitor on Android)
  to `APP_ORIGINS`.
- The origin guard already rejects writes from unlisted origins; keep it.

**Tests:** token login returns a token and no `Set-Cookie`; `/me` works with the header
and not with the token in a cookie of the wrong name; logout with the header revokes it;
preflight from an allowed origin succeeds and from another origin gets no CORS headers.

### 8.2 Client session transport

- [x] Done

**Files:** new `src/client/lib/platform.ts`, new `src/client/lib/sessionStore.ts`,
`src/client/lib/api.ts`, `src/client/features/auth/session.ts`.

**New dependencies:** `@capacitor/core`, `@capacitor/preferences` (or the secure-storage
plugin chosen in 8.4, if doing both together).

- `platform.ts`: `isNative` from `Capacitor.isNativePlatform()`.
- `sessionStore.ts`: `getToken()`, `setToken(token)`, `clearToken()`. On the web these are
  no-ops returning null. Natively they read and write device storage and keep an in-memory
  copy so `api.ts` stays synchronous per request.
- `api.ts`: when native, send `Authorization: Bearer` and omit `credentials: "include"`.
- Login and register send `transport: "token"` when native and store the returned token;
  logout clears it; a 401 `unauthenticated` clears it.
- App start-up must load the stored token before the first `/me` call.

**Accept when:** the web app behaves exactly as before (cookie flow, all tests green).

### 8.3 Capacitor project

- [x] Done

**Files:** new `capacitor.config.ts`, new `android/` (generated), `package.json` scripts,
`.gitignore`, `src/client/styles.css`, `src/client/features/shell/*`, `README.md`.

**New dependencies:** `@capacitor/cli`, `@capacitor/android`, `@capacitor/app`,
`@capacitor/status-bar`, `@capacitor/keyboard`.

- `capacitor.config.ts`: app id (ask the user; for example `com.<name>.payperiodbudget`),
  app name "Pay Period Budget", `webDir: "dist/client"`.
- Scripts: `build:android` (`VITE_API_BASE_URL=<server> vite build && cap sync android`)
  and `open:android`. Read the server URL from `.env.android` so it isn't hard-coded.
- Hardware back button (`@capacitor/app` `backButton`): close an open dialog or drawer
  first; otherwise go back in history; at the root, exit the app.
- Status bar colour and icon style follow the theme. Confirm the safe-area padding from
  phase 2 looks right with gesture navigation.
- Keyboard: the dialog's actions stay visible when the keyboard opens.
- App icon and splash screen from a single source image (ask the user for artwork, or use
  the wallet mark from the sign-in page).
- Document in `README.md`: prerequisites, building, installing on a device, and the
  `APP_ORIGINS` entry the server needs.

**Accept when:** a debug build installed on a device signs in against the real server,
survives being closed and reopened without asking for the password, and every screen from
phases 2 to 7 works by touch.

### 8.4 Biometric unlock

- [ ] Done

**Files:** `src/client/lib/sessionStore.ts`, new `src/client/features/auth/BiometricGate.tsx`,
`src/client/features/settings/*`, plus whatever the chosen plugin requires in `android/`.

**New dependency:** one biometric + secure-storage plugin. Evaluate what is maintained and
compatible with the installed Capacitor version at the time (candidates to look at:
`@aparajita/capacitor-biometric-auth` with `@aparajita/capacitor-secure-storage`, or
`capacitor-native-biometric`). Requirements: the secret is stored in the Android Keystore,
and releasing it requires a biometric (or device credential) check enforced by the OS, not
just a boolean returned to JavaScript.

Behaviour, the same pattern banking apps use:

- After the first successful password sign-in on a device that has biometrics enrolled,
  offer once: "Unlock with fingerprint or face next time?"
- If accepted, the session token moves from plain preferences into biometric-protected
  storage. It is no longer readable without a successful prompt.
- On cold start, and when the app returns to the foreground after more than 5 minutes
  away, show a lock screen and trigger the prompt. Success loads the token into memory;
  cancel leaves the lock screen with "Try again" and "Use password instead" (which clears
  the stored token and shows the sign-in form).
- Too many failures or biometrics removed from the device → fall back to the password.
- A Settings toggle turns the feature off (moves the token back to plain storage) or on.
- Server-side nothing changes: it is still an ordinary revocable session, visible under
  "Signed-in devices".

**Accept when:** on a Pixel, after one password sign-in the app opens with a fingerprint
alone; with the feature on, the token cannot be read from app storage on a debug build
without passing the prompt; revoking the session from the web's Settings page forces a
password sign-in on the phone.

## Implementation notes

**8.1 completed 2026-10-10.** The rest of this phase is on hold at the owner's request.

- `transport` is accepted by `registerRequestSchema` / `loginRequestSchema` in
  `src/shared/auth.ts`; the form schemas (`registerInputSchema`, `loginInputSchema`) are
  unchanged, so the web forms are unaffected.
- `readSessionToken(c)` in `middleware/session.ts` returns the token and whether it came
  from the header or the cookie. The header wins when both are present. A rejected header
  token does not touch cookies.
- A token session that gets extended reports the new expiry in `X-Session-Expires`; the
  header is exposed through CORS along with `Retry-After`.
- CORS allows exactly the origins in `APP_ORIGINS`, with credentials. Same-origin and
  non-browser requests get no CORS headers and need none.
- A token session is an ordinary row in `sessions`: it appears under Settings → Signed-in
  devices and is revoked the same way.
- For 8.2: the client seam is still `src/client/lib/api.ts` (`BASE_URL`, and where the
  `Authorization` header would be added). The Android app's origin must be added to
  `APP_ORIGINS` on the server.

**8.2 completed 2026-10-11.** Verified by unit tests and, for the web flow, in a browser.
The native path has not run on a device yet; that happens in 8.3.

- Storage is `@capacitor/preferences` (plain app-private storage). 8.4 moves the token
  behind the Keystore; `sessionStore.ts` is the only file that knows where it lives.
- `sessionStore.ts` also exports `loadToken()`, which `main.tsx` awaits before rendering.
  Unreadable storage counts as signed out rather than leaving a blank screen.
- `api.ts` on native sends `Authorization: Bearer` and `credentials: "omit"`. A 401
  `unauthenticated` clears the token only if it is still the one that request was sent
  with, so a late refusal of an old token cannot wipe a newer sign-in.
- Sign-in and registration go through `authenticate()` in `features/auth/session.ts`.
  Logging out clears the token even when the server cannot be reached; the server-side
  session then lingers until it expires or is revoked under Signed-in devices.
- `X-Session-Expires` is not read by the client. The token does not change on renewal and
  an expired one is answered with a 401, which already signs the app out.
- `src/client/lib/api.test.ts` covers both platforms by mocking `platform.ts` and the
  preferences plugin.
- For 8.3: nothing stops a native build with an empty `VITE_API_BASE_URL`; the
  `build:android` script should refuse to build without it.
- For 8.3, checked 2026-10-11: Capacitor 8.5.3's Android template uses Gradle 8.14.3,
  Android Gradle Plugin 8.13.0, compile and target SDK 36, Java 21. The development Mac has
  Android Studio 2026.2, whose bundled JDK is 25, and only SDK Platform 37 and Build-Tools
  37. Gradle 8.14 does not run on Java 25, so a JDK 21 is needed before the first build.

**8.3 completed 2026-10-11** on the `Pixel_9_Pro` emulator (Android API 37, WebView 149)
against the development API on the Mac. Not done, and so not part of this tick: a real
phone, the deployed server over HTTPS, a release build, and a touch pass over every screen
(sign-in, setup, home, the add-transaction dialog, the drawer, Recurring and Settings were
used; the rest were not).

Decided with the owner: app id `com.maximx1.payperiodbudget`; the wallet mark as the icon;
develop against the API on the Mac from the emulator, deployment later.

- `capacitor.config.ts` is TypeScript, and the Capacitor CLI cannot load it with
  TypeScript 7 installed, so the CLI runs through `npm run cap` (Node's type stripping).
- The Android copy of the client builds with `vite build --mode android` into
  `dist/android`, not `dist/client`: it has the API address baked in and must never be
  what the server serves. The mode reads `.env.android`; the build stops if
  `VITE_API_BASE_URL` is missing.
- Plain HTTP to the development machine: `allowMixedContent` is switched on only when the
  API address starts with `http://`, and cleartext is permitted only by
  `android/app/src/debug` (to `10.0.2.2` and `127.0.0.1`). A release build has neither.
- `android:allowBackup` is `false`, so the session token is not copied into Google's
  device backup.
- `@capacitor/status-bar` was not added. Capacitor 8 has `SystemBars` in core, and with
  edge-to-edge (enforced from Android 15) the bars are transparent: only the icon style
  follows the theme, set from `src/client/lib/nativeShell.ts`.
- `@capacitor/keyboard` was not added. `interactive-widget=resizes-content` already
  shrinks the page when the keyboard opens (952 to 616 CSS px on the emulator) and the
  add-transaction dialog keeps Add and Cancel on screen.
- Back button: `nativeShell.ts` dispatches `cancel` at the topmost open `<dialog>`, which
  is what Escape does, so `useModal.ts` needed no change.
- Icon and start-up screen are vector drawables of the Lucide wallet mark plus PNGs for
  Android 7; no asset-generation package. Colours are copied from `styles.css`.
- `android/gradle/gradle-daemon-jvm.properties` asks for Java 21, so Android Studio's own
  Java 25 is not used for the build.

Checked on the emulator, driving the app with `adb` and reading the WebView over its
debug port:

- `./gradlew assembleDebug` succeeds with Temurin 21 and fetched SDK Platform 36 itself.
  With Android Studio's Java 25 it fails: "Unsupported class file major version 69".
- Sign-in uses the token (no cookie), the token lands in the app's preferences, and a
  force-stop and reopen goes straight in with `/api/auth/me` answering 200.
- Revoking the phone's session from another client sends the app to the sign-in page on
  its next request and removes the stored token.
- `/theme.js` loads. `env(safe-area-inset-*)` reports 52px top and 24px bottom with
  gesture navigation; the top bar, drawer and + button sit clear of both bars.
- Back closes the keyboard, then the dialog; closes the drawer; walks back through
  Settings, Recurring, Home; and leaves the app at the root.
- Status-bar icons follow the device's dark mode and the app's own Light/Dark setting.
- The start-up screen and launcher icon show the wallet mark, in light and dark.

Left for later:

- The phone's session is listed under Signed-in devices as "Chrome on Android". Setting
  `appendUserAgent` in `capacitor.config.ts` and teaching the server's device label about
  it would let it say "Android app".
- The start-up screen follows the device's theme, not the app's own setting, so a user
  who forces the other theme sees one frame of the wrong background.

**8.4 written 2026-10-11; not ticked.** Unit-tested, and run on the emulator only as far as
a phone with no fingerprint goes. **No biometric prompt has ever been shown by this app.**
The emulator had no screen lock or fingerprint; enrolling one is the owner's to do.

The owner's brief: this is only an easy way to skip the password. After one password
sign-in the fingerprint alone opens the app.

- Plugin: `@capgo/capacitor-native-biometric` 8.8.1. Its Android source was read before
  choosing it. `setData` with an access-control level encrypts under an AES key wrapped by
  an Android Keystore RSA key created with `setUserAuthenticationRequired(true)` and
  `AUTH_BIOMETRIC_STRONG`; `getSecureData` unwraps it through a `BiometricPrompt`
  `CryptoObject`. Storing needs no prompt; reading always does.
- Rejected: `@aparajita/capacitor-biometric-auth` with `capacitor-secure-storage`, and the
  original `capacitor-native-biometric` (Capacitor 3, last published 2023). Neither binds
  the stored secret to a biometric check; they return a yes/no to JavaScript.
- `AccessControl.BIOMETRY_ANY`, not `BIOMETRY_CURRENT_SET`: adding a fingerprint later does
  not send the owner back to the password. The cost is that someone who knows the phone's
  PIN could enrol their own fingerprint and open the app.
- All of it is in `src/client/lib/sessionStore.ts`: where the token lives (preferences or
  the vault), the lock state, `unlock()`, `lock()`, turning the feature on and off, the
  one-time offer and the five-minute rule. `sessionStore.test.ts` covers it against a fake
  phone.
- Turning it on stores the token, then reads it back through one prompt before deleting
  the plain copy. If that check fails or is cancelled, nothing changes.
- `BiometricGate` (in `main.tsx`, around the router) shows the lock screen instead of the
  app while locked, so nothing behind it is mounted and no request is made. It prompts at
  once; cancel leaves "Unlock" and "Use password instead".
- "Use password instead" forgets the token on the phone. It cannot sign the session out on
  the server, because doing so needs the token; the session stays listed under Signed-in
  devices until it expires or is signed out there.
- The password is asked for again only when: the user logs out, the session is signed out
  from another device or expires (30 days unused; it is extended while in use), or every
  fingerprint is removed from the phone.
- The offer (`BiometricOffer`, mounted by `RequireAuth` in the app only) appears once per
  phone. Settings has an "App lock" section, shown in the app only.
- Hardware Back on the lock screen minimises the app.

Checked on the emulator with no fingerprint enrolled: the build includes the plugin and
runs, no offer appears, and Settings shows App lock disabled with "Add a fingerprint or
face in the phone's settings to use this."

Still to check, with a fingerprint enrolled (emulator first, then the Pixel):

1. After a password sign-in the offer appears once; "Turn on" shows one prompt.
2. Force-stop and reopen: lock screen, prompt, straight into the app with no password.
3. Cancel the prompt: lock screen stays; "Unlock" prompts again; "Use password instead"
   shows the sign-in form.
4. More than five minutes in the background locks it; less does not.
5. With it on, `shared_prefs/CapacitorStorage.xml` holds no `session.token`, and the
   plugin's preferences hold only ciphertext (`run-as` on a debug build).
6. Signing the phone out from the web's Settings forces a password sign-in.
7. Turning it off in Settings: reopening goes straight in with no prompt.

