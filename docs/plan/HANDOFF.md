# Handoff

Written 2026-10-10 at the end of the session that built phases 0 to 7. Read this first when
picking the project up; it says where things stand, what is left, what must be installed
before the remaining work can start, and how the owner likes to work.

Kick-off prompt for the next session:

> Read CLAUDE.md and docs/plan/HANDOFF.md, then tell me where things stand and what you
> need from me before starting.

## Where things stand

- Repository: `github.com/maximx1/pay-period-budget` (public), branch `main`.
- `npm run check` passes: 593 tests, 25 files. `npm run build` is clean.
- The web app is complete for daily use: accounts and sign-in, budget setup, pay periods,
  transactions, recurring bills and income, period adjustments, manual ordering, settings.
- It has only ever run on the development machine. Nothing is deployed.

| Piece | State |
| --- | --- |
| Phases 0 to 7 | Done. Each phase file ends with implementation notes; where they differ from the task text, the notes win |
| 7.1 Date search | Done 2026-10-11 as a dialog opened from the period's date range |
| 8.1 Token sign-in and CORS | Done |
| 8.2 Client session transport | Done 2026-10-11 |
| 8.3 Capacitor project | Done 2026-10-11 on the emulator against the dev API. Not yet on a real phone, against a deployed server, or as a release build |
| 8.4 Biometric unlock | **Written and unit-tested 2026-10-11; the fingerprint path has never run.** Needs a device or emulator with a fingerprint enrolled |
| Periods before the first one | Done 2026-10-11 (decision 12). The back arrow adds them; today's numbers stay fixed |
| 9 Resetting a modified starting amount | **Planned only.** The owner asked for the phase; what it covers needs confirming first |
| 10 Projections tab | **Planned only** |
| 11 API tokens, bulk import, MCP server | Done 2026-10-11: tokens on the server and in Settings, transactions by date range, bulk import, the MCP server, instructions in `README.md`, history up to five years back. **Not yet deployed.** The MCP server has not been registered with a real assistant or run against the deployed server; decisions are at the top of the phase file |
| 12 Idle timeout and face unlock | Built 2026-10-12. Web half checked in a browser; **the Android half has never run**. The phase file ends with what to try on a phone |
| 13 Transactions tied to a recurring item | 13.1 (linking and part payments in the API) done 2026-10-12. 13.2 to 13.7 not started; the owner took both suggestions in the phase file |
| Docker packaging and deploy guide | Written, **never built or run** (see "Not yet verified") |
| Backlog (`backlog.md`) | Accounts feature, Google sign-in, passkeys, more schedules, forgot-password, iOS |

## What is left, in the order that makes sense

### 1. First deployment (owner does this on the server; expect to debug it together)

`docs/deploy.md` is the walkthrough. The phone app cannot be tested against anything real
until this exists, so it comes before phase 8.

**Decided 2026-10-11:** the owner already runs nginx on a server, so this is the "existing
reverse proxy" route in the guide. The owner is doing it now, with an AI assistant on the
server following `docs/deploy-agent.md`, and is arranging the domain and the nginx site
separately. Once it is up, the Android app only needs that address typed into its
"Connect to your server" screen.

After the first account exists: set `ALLOW_REGISTRATION=false`.

### 2. Phase 8.2: client session transport (done 2026-10-11)

Built as specified; see the implementation notes in `phase-08-android.md`. The original
notes are kept below for reference.

Spec in `phase-08-android.md`. Adds `@capacitor/core` and a storage plugin. The web app
must behave exactly as before (cookie flow). Things the spec does not say that matter:

- The seam is `src/client/lib/api.ts`: `BASE_URL` already reads `VITE_API_BASE_URL`; the
  `Authorization` header and dropping `credentials: "include"` on native go there.
- Sign in and register with `transport: "token"` on native; the response type is
  `TokenAuthResponse` in `src/shared/auth.ts`.
- A renewed session reports its new expiry in the `X-Session-Expires` response header.
- The stored token must be loaded before the first `/api/auth/me` call, or the app flashes
  the sign-in page on every launch.
- Changing the password signs out every *other* session; the phone keeps its own.

### 3. Phase 8.3: the Capacitor project (done 2026-10-11 on the emulator)

What was built, decided and checked is in the implementation notes of
`phase-08-android.md`; the notes below are the original ones. To run it again: start the
`Pixel_9_Pro` emulator and `npm run dev`, then `npm run build:android` and, in `android/`,
`./gradlew installDebug`. The dev machine has a gitignored `.env` (adds
`https://localhost` to `APP_ORIGINS`) and `.env.android` (API at `http://10.0.2.2:8787`).

- Current Capacitor is 8.5 (checked 2026-10-10): Node 22+, JDK 21, Android Gradle Plugin
  8.13, compile and target SDK 36, minimum SDK 24. Re-check before installing.
- **Ask the owner for the app id** (for example `com.<something>.payperiodbudget`) and for
  icon artwork, or use the wallet mark from the sign-in page.
- Capacitor serves the app from `https://localhost` on Android. That origin must be added
  to `APP_URL` / `APP_ORIGINS` on the server (comma-separated), or every request from the
  phone is refused as cross-origin.
- `public/theme.js` is referenced as `/theme.js`; confirm it loads inside the WebView.
- The shell already pads for safe areas and `index.html` already sets
  `interactive-widget=resizes-content`; verify both on a real device rather than assuming.
- The hardware back button should close an open dialog or drawer first. Both are native
  `<dialog>` elements driven by `components/ui/useModal.ts`.
- For development before the server is ready: an emulator reaches the dev machine at
  `10.0.2.2`, and a USB-connected phone can use `adb reverse tcp:8787 tcp:8787`. Either
  way the WebView is on `https://localhost` calling plain `http`, which Android blocks by
  default; that needs a debug-only cleartext allowance. Using the deployed HTTPS server
  avoids the whole problem, which is another reason to deploy first.

### 4. Phase 8.4: biometric unlock (written 2026-10-11, fingerprint path not yet run)

State, decisions and what is left to check are in the implementation notes of
`phase-08-android.md`. The owner's brief: it is only a way to skip the password. After one
password sign-in the fingerprint alone must open the app, with no credentials after it.
The paragraph below is the original note.

Use the stronger model for this one. The requirement that matters: the token is held in
the Android Keystore and released only after an OS-enforced biometric check, not merely
hidden behind a boolean in JavaScript. Evaluate the plugin candidates named in the spec
against the installed Capacitor version at the time. Needs a real device with a
fingerprint enrolled; an emulator can simulate one but is not proof.

### 5. Open decisions (none block the above)

- **Paycheck when a period's start moves later:** an "every pay period" transaction dated
  on the old first day falls into the previous period, because transactions belong to
  whichever period covers their date. The preview warns; fixing the transaction's date
  brings it back. The alternative is to make pay-period transactions follow their period's
  start. The owner has not asked for it.
- **The + button on phones** floats over the end of the row behind it while scrolling.
  Could dock into the top bar instead.
- **Forgot password** does not exist; it needs a way to send email.
- **Git history:** commits carry the owner's name and email, and early versions of
  `CLAUDE.md` name a sibling folder. The owner was told and said it is fine. Do not rewrite
  history unless asked.

## What the owner needs to install or set up

Checked on the development Mac on 2026-10-10. **Rechecked 2026-10-11** after the owner
installed Android Studio 2026.2: its bundled JDK is 25, the SDK has Platform 37 and
Build-Tools 37 only, and there is a `Pixel_9_Pro` emulator on API 37. Capacitor 8.5.3 still
builds with Gradle 8.14.3 against SDK 36 on Java 21, so it also needed a
**JDK 21** (Gradle 8.14 does not run on Java 25), now installed with
`brew install --cask temurin@21`, and **SDK Platform 36**, which the first build fetched by
itself. Nothing is missing for the emulator. A real phone still needs USB debugging and,
for 8.4, a fingerprint enrolled. The table below is the 2026-10-10 state.

**For the Android work (on the Mac)**

| Needed | Found | Action |
| --- | --- | --- |
| A current Android Studio (it bundles JDK 21) | Version 2020.3 from 2021, far too old | Install the latest stable Android Studio over it |
| Android SDK Platform 36 and Build-Tools 36 | Only API 32 | Android Studio → Settings → Android SDK: tick Android 16 (API 36); under SDK Tools tick Build-Tools 36 and update Platform-Tools |
| A device to run on | An old API 32 emulator | Preferably the Pixel: enable Developer options and USB debugging, enrol a fingerprint, connect by USB. Or create an API 36 emulator |
| `adb` and Java on the command line | Neither on `PATH` | Optional. Add `~/Library/Android/sdk/platform-tools` to `PATH`; point `JAVA_HOME` at Android Studio's bundled JDK. Android Studio itself needs neither |
| Node 22+ | 22.15 | Nothing |

Capacitor's npm packages are installed by the session when 8.2 and 8.3 start; nothing to
download by hand.

**For deployment (on the Arch server)**

- `sudo pacman -S docker docker-compose docker-buildx` and
  `sudo systemctl enable --now docker`.
- One of: Tailscale on the server and the phone; or a domain pointing at the server; or an
  existing reverse proxy.
- Somewhere for backups to go that is not the server itself.

**Optional**

- Docker Desktop (or another Docker) on the Mac, so the image can be built and tested
  before it reaches the server. Without it the server is where problems show up.
- `xcode-select --install` on the Mac. Its command line tools are broken. Nothing in this
  project needs them, which is deliberate, but other tooling may.

## Not yet verified

Be straight with the owner about these until they have been exercised.

- **The Dockerfile has never been built.** The same file layout with runtime-only
  dependencies was assembled by hand and the same start command run in production mode;
  health check, secure cookie, origin check, backup, clean stop and restart all worked.
  The image build itself, the non-root user, the read-only filesystem and the volume
  permissions are untested.
- **`compose.yaml` profiles** (`caddy`, `autoheal`) and **`deploy/backup.sh`** have never
  run. The backup *script* it calls (`npm run db:backup`) has.
- **The sign-in page with registration closed** is covered by API tests; the page itself
  was only viewed with registration open.
- **A successful password change** is covered by tests, not clicked through in a browser.
- **Nothing has run on a real phone.** The Android app has run on an emulator only, as a
  debug build, against the development API over plain HTTP. A release build, HTTPS to a
  deployed server and a touch pass over every screen are all still to do.

## How to check your work here

- `npm run dev` starts both servers; the app is at `http://localhost:5173`.
  `.claude/launch.json` has the same thing as a `dev` configuration for the preview pane.
- `npm run db:seed` creates the stub account in `src/server/scripts/seed.ts`. Sign in with
  it for browser checks.
- A budget and data can be created quickly from the browser console with `fetch` against
  `/api/budget`, `/api/transactions` and `/api/recurring` while signed in.
- **Clean up afterwards**: remove the test budget, transactions and recurring items from
  the stub account so the owner lands on the setup screen. Deleting the stub's rows from
  `budget_schedules` and `user_settings` (with foreign keys on) cascades to its periods;
  delete its `transactions` and `recurring_items` explicitly.
- Every UI change gets looked at around 375px and 1280px, in light and dark.
- `/dev/ui` (dev server only) shows every shared UI primitive.
- When a rule matters, break it on purpose once and confirm a test fails.

## Working with the owner

- **Commits:** only when asked. The rhythm so far has been "commit phase N and start
  phase N+1". End commit messages with the co-author line the session provides.
- **Pushing:** `main` tracks `origin/main`. Push when asked.
- **Model:** the owner asked to stay on the stronger model for this project rather than
  hand tasks to a cheaper one, despite the "Suggested model" lines in the phase files.
- **Decisions:** make a recommendation, apply the sensible default, and list what was
  decided so it can be overruled. Ask only when a choice is expensive to reverse.
- **Reports:** say plainly what was verified and how, and what was not.
- **Names:** recurring bills and income are *recurring items*. *Accounts* is reserved for a
  future feature (savings accounts, payees). See decision 11 in `README.md`.
- **Scope:** folders beside this project are unrelated. Leave them alone.

## Where the knowledge lives

| For | Read |
| --- | --- |
| Commands, layout, conventions, pitfalls | `CLAUDE.md` |
| What must always be true about periods, carry-over, recurring items; the API list | `docs/plan/domain.md` |
| Status table, what each phase delivered, decisions 1 to 11 | `docs/plan/README.md` |
| Task specs and, at the bottom of each, what actually got built | `docs/plan/phase-0N-*.md` |
| Running, configuring, deploying | `README.md`, `docs/deploy.md` |
| Everything not yet planned | `docs/plan/backlog.md` |

Three lessons from this session that are easy to trip over again, all recorded in
`CLAUDE.md` or the phase notes:

1. The SQLite driver waits for a locked database synchronously, so all database access is
   queued in the store. Inside `store.transaction()` use only the repos passed in.
2. `drizzle-kit` has dropped `ON DELETE` from a foreign key added to an existing table.
   Read generated migrations.
3. No packages that compile native code on install.
