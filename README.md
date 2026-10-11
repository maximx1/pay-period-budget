# Pay Period Budget

A budgeting app organised around pay periods instead of calendar months. One small server
provides the API and serves the web app; the data lives in a single SQLite file.

- **Deploying to a server with Docker:** [docs/deploy.md](docs/deploy.md)
- **How the code is organised and its conventions:** [CLAUDE.md](CLAUDE.md)
- **Roadmap and domain rules:** [docs/plan/](docs/plan/README.md)

## Run it on your own machine

Requires Node 22 or newer. Nothing needs compiling; no database server is involved.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and create an account. `npm run db:seed` creates the stub
account defined in `src/server/scripts/seed.ts` if you would rather not type one in.

In development two processes run side by side: the API on port 8787 and the Vite dev
server on 5173, which forwards `/api` to the API and reloads the page as you edit.

The database is `data/app.db`. Delete the `data/` folder to start again from nothing.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (with reload on change) and web dev server together |
| `npm run check` | Type-check and run every test |
| `npm run test:watch` | Tests in watch mode |
| `npm run build` | Build the web app into `dist/client` |
| `npm start` | Run in production mode: one process serving the API and `dist/client` |
| `npm run db:generate -- --name <what_changed>` | Create a migration after editing the schema |
| `npm run db:seed` | Create the local stub account |
| `npm run db:backup -- <file>` | Write a consistent copy of the database, safe while running |

Migrations are applied automatically whenever the server starts.

## Run it in production mode without Docker

```bash
npm ci
npm run build
APP_ORIGINS=https://budget.example.com npm start
```

One process listens on port 8787 and serves everything. Put it behind HTTPS: in production
the session cookie is only sent over HTTPS, so signing in over plain `http://` will not
stick unless you set `COOKIE_SECURE=false`.

## Configuration

Everything is set through environment variables. In development a `.env` file in the
project folder is read as well (see `.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` serves the built web app and tightens cookie settings |
| `API_PORT` | `8787` | Port the server listens on. In production `PORT` is also honoured |
| `DATABASE_URL` | `file:./data/app.db` | Where the SQLite file lives |
| `APP_ORIGINS` | `http://localhost:5173` | Comma-separated addresses the app is opened at. Changes from any other origin are refused. **Must be set in production** |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy, so rate limits see the visitor's address rather than the proxy's |
| `COOKIE_SECURE` | `true` in production | Session cookie is HTTPS-only |
| `ALLOW_REGISTRATION` | `true` | `false` stops new accounts being created |
| `SESSION_TTL_DAYS` | `30` | How long a sign-in lasts without use; it is extended while in use |

## Signing in from something other than the web app

The web app uses an httpOnly cookie. Another client, such as a phone app or a script, can
ask for a token instead:

```bash
curl -X POST https://budget.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier": "you", "password": "…", "transport": "token"}'
```

The response contains `token`; send it on later requests as `Authorization: Bearer <token>`.
It is an ordinary session: it shows up under Settings → Signed-in devices and can be
signed out from there. The endpoints are listed in
[docs/plan/domain.md](docs/plan/domain.md#api-surface).

## Android app

The same web app wrapped with [Capacitor](https://capacitorjs.com). The project lives in
`android/`; it signs in with a token instead of a cookie and otherwise talks to the same API.

**You need**

- Android Studio with SDK Platform 36 (the build fetches it if it is missing).
- A JDK 21 that Gradle can find. Android Studio 2026.2 bundles Java 25, which the Gradle
  version Capacitor 8 uses cannot run on: `brew install --cask temurin@21`.
- A phone with USB debugging on, or an emulator.

**The server has to allow the app.** The app's pages are served from `https://localhost`
inside the phone, so that origin must be in the server's `APP_ORIGINS`, next to the web
address. The Docker setup adds it by default (`APP_ALSO_ALLOW` in `.env.docker.example`).
Without Docker:

```
APP_ORIGINS=https://budget.example.com,https://localhost
```

**Build and install**

1. `npm run build:android` builds the web app into `dist/android` and copies it into the
   Android project. Run it again after every change to the web code.
2. `npm run open:android` opens the project in Android Studio; press Run. Or, from
   `android/`, `./gradlew installDebug` installs on the connected device.

**Connecting it to a server.** The first time it opens, the app asks for the server's
address: type what you open in a browser, for example `https://budget.example.com`. It
checks that a budget server answers there and remembers it. "Change server" under the
sign-in form asks again. Only `https://` addresses are accepted.

**Fingerprint unlock.** On a phone with a fingerprint or face enrolled, the app offers once
to unlock that way. After that the password is only needed if you log out, the session
ends, or every fingerprint is removed from the phone. Settings → App lock turns it on or off.

**Against the API on this machine.** A debug build may also use plain HTTP to reach the
development server; a release build never can. Put `https://localhost` in `APP_ORIGINS` in
`.env`, start `npm run dev`, run `adb reverse tcp:8787 tcp:8787`, and connect the app to
`http://127.0.0.1:8787` (an emulator can use `http://10.0.2.2:8787` without `adb reverse`).
`.env.android.example` shows how to build that address in so the app does not ask.
