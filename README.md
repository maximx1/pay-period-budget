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
