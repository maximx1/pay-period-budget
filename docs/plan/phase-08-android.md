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

- Android Studio and a JDK installed; a Pixel or emulator available.
- The API reachable from the phone over **HTTPS** (a reverse proxy with a certificate, or a
  private network such as Tailscale with HTTPS enabled). Android blocks plain HTTP by
  default and the session cookie/token should never travel unencrypted.
- Check the current Capacitor major version and its Node requirement before installing.

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

- [ ] Done

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

- [ ] Done

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

