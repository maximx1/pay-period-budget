# Phase 12: Idle timeout, and face unlock

**Goal:** the budget does not stay open on an unattended screen. After ten minutes without
activity the web app signs out and the Android app locks. On a phone that allows it, the
lock opens with a face, with the fingerprint as the fallback.

**Status:** asked for by the owner on 2026-10-12 and built the same day. The web half was
checked in a browser. **Nothing in the Android half has run on a phone or an emulator**,
and neither has the biometric unlock it builds on (phase 8.4).

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **On the web, idle means signed out**, with the password needed again. There is nothing
   else a browser could be locked with.
2. **The server enforces it for browsers too**, not only the page. A closed tab, or a
   cookie copied off the machine, stops working after the same ten minutes (plus two; see
   below). Sessions that existed before this was deployed do not have the server-side
   limit until their next sign-in; the page still signs them out.
3. **In the Android app, idle means locked** when face or fingerprint unlock is on, and
   **signed out** when it is off. Without the lock there is nothing to protect the app with
   short of the password, so it behaves like the web app.
4. **Time in the background counts.** This replaces the separate "five minutes away" rule
   the app had: there is now one clock and one number.
5. **One setting, `IDLE_TIMEOUT_MINUTES`** on the server (default 10, 0 for off), which
   the web app and the Android app both read from `GET /api/auth/config`. If the app
   cannot ask, it uses ten.
6. **"Activity" is input**: a tap, click, key, scroll, or the pointer moving. A page that
   is merely open is not in use.

## What was built

### Server

- `sessions.idle_timeout_ms` (nullable). Set when signing in with the cookie, null for
  `transport: "token"`. `authenticate` refuses and deletes a session whose last request is
  older than the timeout plus `IDLE_GRACE_MS` (two minutes).
- Why the two minutes: the server must never end a session before the page would. Its
  record of the last request is good to the minute (`IDLE_SEEN_RESOLUTION_MS`), and while
  someone reads or types the page makes no requests, so it sends a keepalive at most every
  30 seconds of activity (`IDLE_KEEPALIVE_MS` in `src/client/lib/idle.ts`). Worst case the
  server's record is 90 seconds behind the page's.
- The hourly purge also deletes idle sessions, and they are left out of "Signed-in devices".
- **`createTestApp()` turns the timeout off** unless a test passes
  `{ IDLE_TIMEOUT_MINUTES: "10" }`: most tests move the clock by days with a cookie client.

### Client

- `src/client/lib/idle.ts`: the time of the last activity, kept in `localStorage` so that
  tabs share it and it survives a reload or the app being closed; `startIdleWatch`, which
  fires once when the limit passes. A first input after the limit is treated as finding
  the app idle, not as activity. Checked every 15 seconds, when the page becomes visible,
  and when the Android app returns to the foreground (`recheckIdle`).
- `features/auth/IdleGuard.tsx` wraps everything inside `RequireAuth`. When idle: `lock()`
  on the Android app with biometric unlock on, otherwise sign out and leave a note that
  the sign-in page shows ("You were signed out after 10 minutes without activity.").
  It shows a spinner instead of the budget while the timeout is not yet known or is
  already past, so reopening after too long never flashes the numbers.
- Signing in and unlocking both call `markActive()`. **Any new way into the app must do
  the same**, or the guard will find the old timestamp and close the app at once.
- `sessionStore.ts` lost `AWAY_LIMIT_MS`, `noteAppHidden` and `noteAppShown`.

### Face unlock

No code decides between face and fingerprint, and none can.

- The token is encrypted under an Android Keystore key that requires a Class 3 ("strong")
  biometric. That is what makes the lock real, and it is why only strong biometrics count.
  The plugin (`@capgo/capacitor-native-biometric` 8.8.1) asks `BiometricPrompt` for
  `BIOMETRIC_STRONG`; Android then offers every strong biometric that is enrolled, in one
  prompt. An app cannot name one or order them.
- Where face unlock is Class 3 (Pixel 8 and later; the owner's emulator image is a Pixel 9
  Pro), the prompt reads the face and has the fingerprint sensor live at the same time.
  That is face first with fingerprint as the fallback. Where face unlock is Class 1 or 2
  (older Pixels, most other phones) the prompt offers the fingerprint only.
- **A "Confirm" tap after the face is recognised is likely.** `BiometricPrompt` asks for
  it by default for a face; the plugin does not expose `setConfirmationRequired(false)`.
  Removing it means patching the plugin or asking its authors.
- The wording now says "face or fingerprint" throughout, and the lock screen's button
  shows a face.

## Checked, and not

- Server: tests with the fake clock in `routes/auth.test.ts` ("a browser left idle").
- Idle logic: `lib/idle.test.ts` with fake timers, including another tab keeping it alive,
  a clock that jumps (a laptop waking), and storage that refuses writes.
- In a browser against the dev server: reopening with the last activity 11 minutes old
  signs out before anything is shown, ends the session on the server and shows the note;
  signing in clears it; input is recorded; the new session carries the timeout.
- **Not checked:** waiting out a real ten minutes in an open tab (the timer path is only
  unit-tested); anything on Android: the lock after idle, the sign-out with the lock off,
  the return from the background, and face unlock itself.

## To do on a phone

1. Build and install (`npm run build:android`), sign in, turn on App lock.
2. Leave it for ten minutes in the foreground: it should show the lock screen.
3. Send it to the background for ten minutes and return: the same.
4. Unlock with a face, then with a finger over the sensor while looking away.
5. Turn App lock off and leave it ten minutes: it should sign out and say why.
