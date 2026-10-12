# Pay Period Budget

A budgeting app organised around pay periods instead of calendar months. One small server
provides the API and serves the web app; the data lives in a single SQLite file.

- **Deploying to a server with Docker:** [docs/deploy.md](docs/deploy.md)
- **Letting an AI assistant work with your budget:** [Using it from an AI assistant](#using-it-from-an-ai-assistant-mcp)
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
| `npm run build:mcp` | Build the MCP server for AI assistants into `dist/mcp/ppb-mcp.mjs` |

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
| `SESSION_TTL_DAYS` | `30` | The longest a sign-in lasts without use; it is extended while in use |
| `IDLE_TIMEOUT_MINUTES` | `10` | Minutes without activity before the web app signs out and the Android app locks. `0` turns both off |

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

A script or an assistant that should never hold your password uses an **API token**
instead: Settings → API tokens. It is sent the same way, reaches budget data only, can be
read-only, and is revoked by itself or by changing your password.

## Using it from an AI assistant (MCP)

`mcp/` is a small [Model Context Protocol](https://modelcontextprotocol.io) server that
lets a command-line assistant read your budget, add and change transactions, and import a
bank export. It holds an API token, never your password.

**Where it runs and what leaves your machine.** It is a local program and nothing else:
the assistant starts it as a child process and talks to it over stdin and stdout. It
opens no port, is not hosted anywhere, and its only network connection is to your own
budget server. There is no remote or web version. Two things are worth knowing all the
same:

- What a tool returns is read by the model behind the assistant. Transactions the
  assistant looks at are therefore sent to whoever runs that model, exactly as if you had
  pasted them into it. Only a model running on your own machine keeps them there.
- The token sits in the assistant's configuration file in plain text. Anyone who can read
  that file can use it until you revoke it.

### 1. Create a token

In the web app: Settings → API tokens → New token. Choose **Read and write** if the
assistant is to add or import anything, and an expiry you are comfortable with. Copy the
token; it is shown once. A read-only token is enforced by the server, so it is the way to
let an assistant look without being able to change anything.

### 2. Build the server

```bash
npm install
npm run build:mcp
```

This writes one file, `dist/mcp/ppb-mcp.mjs`, which needs only Node 22 or newer to run.
Build it again after updating this repository. The budget server it talks to must be
running a version that has API tokens.

It is configured with two environment variables:

| Variable | Meaning |
| --- | --- |
| `PPB_URL` | Your budget server's address, e.g. `https://budget.example.com`. Must be `https://` unless it is this machine (`http://localhost:8787` for the development server) |
| `PPB_TOKEN` | The API token from step 1 |

### 3. Register it with your assistant

Use the absolute path of the built file. Replace the address and token in each example.

**Claude Code**

```bash
claude mcp add --env PPB_URL=https://budget.example.com --env PPB_TOKEN=ppb_your_token --transport stdio ppb -- node /absolute/path/to/pay-period-budget/dist/mcp/ppb-mcp.mjs
```

Options go before the name, and `--transport stdio` has to sit between the last `--env`
and the name. Run it from the folder you will work in: by default the server is added for
that folder only and stored in `~/.claude.json`. Add `--scope user` to have it everywhere.
**Do not use `--scope project`**: that writes the token into a `.mcp.json` file meant to
be committed. `claude mcp list` shows whether it connected, `/mcp` does the same inside a
session, and `claude mcp remove ppb` takes it out.

**Hermes Agent**: add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  ppb:
    command: "node"
    args: ["/absolute/path/to/pay-period-budget/dist/mcp/ppb-mcp.mjs"]
    env:
      PPB_URL: "https://budget.example.com"
      PPB_TOKEN: "ppb_your_token"
```

`hermes mcp test ppb` checks it; `/reload-mcp` picks it up in a running session. Hermes
passes the server only the variables listed under `env`, so if it cannot find `node`, give
the full path from `which node` as the command.

**Cline CLI**: add to `~/.cline/data/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "ppb": {
      "command": "node",
      "args": ["/absolute/path/to/pay-period-budget/dist/mcp/ppb-mcp.mjs"],
      "env": {
        "PPB_URL": "https://budget.example.com",
        "PPB_TOKEN": "ppb_your_token"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

`cline config mcp` lists what is configured, and `cline mcp` opens a menu that can add or
edit the same entry. Leave `autoApprove` empty to be asked before every tool call.

For Hermes and Cline the token is in a file you edit yourself: `chmod 600` it.

If the server will not start it says why on stderr, which each assistant shows in its MCP
status or logs: a missing variable, an `http://` address that is not this machine, or a
token the server refused.

### What the assistant can do

| Tool | Does |
| --- | --- |
| `get_budget` | Pay schedule, first period, opening balance, time zone, today's date there |
| `list_periods` | Every pay period with its dates |
| `get_period` | One period (by id, by date, or the current one): starting amount, totals, transactions |
| `list_transactions` | Transactions between two dates, at most 366 days |
| `list_recurring` | Recurring bills and income |
| `create_transaction`, `update_transaction`, `delete_transaction` | One transaction at a time |
| `import_transactions` | Many transactions from a JSON file, previewed first |

Amounts are whole cents with a kind (`expense` or `income`); results show dollars and
cents together. Dates are wall-clock values in the budget's own time zone.

### Importing a bank export

The server does not read a bank's CSV: every bank's is different. The assistant converts
it to a JSON file and `import_transactions` is given that file's absolute path, so amounts
go from the bank's file to the budget through a script and are never retyped by a model.

The file is an array of rows:

```json
[
  {
    "name": "Kroger",
    "amountCents": 5412,
    "kind": "expense",
    "occursAt": "2026-03-14T00:00",
    "paid": true,
    "note": "POS DEBIT 4417 KROGER #512",
    "importKey": "2026-03-14|-54.12|POS DEBIT 4417 KROGER #512|1"
  }
]
```

`note` and `importKey` are optional, but give every row an `importKey`: a row whose key is
already in the budget is skipped, which is what makes it safe to import the same file, or
next week's overlapping export, again. Use the bank's own transaction id if the export has
one; otherwise date, signed amount, description and a counter among rows identical in all
three.

What to ask the assistant to do, in this order:

1. Call `get_budget`, `list_periods` and `list_recurring` to learn the time zone, the dates
   the budget covers and which bills it already adds by itself.
2. Read the export's header and a few rows, then write a script that converts it to the
   file above, and keep the script for next time. Leave out pending rows; only posted ones
   are stable. Start each download a few days before the last import so every day in it is
   complete, or the counters in the keys will not come out the same.
3. Run `import_transactions` on the file. It is a dry run unless told otherwise: nothing
   is saved, and it reports the totals per pay period, the change to today's figures and
   any **possible duplicates** (a transaction already in the budget with the same amount
   within three days, typically a recurring bill the app added as upcoming).
4. For each possible duplicate that is the same payment, take the row out of the file and
   change the existing transaction instead: its real date, its real amount, paid. Ask you
   about any that are unclear.
5. Run the dry run again and show you the result. Import with `dryRun: false` only when
   you say so.
6. Afterwards the current period's "leftover so far" should equal the bank's posted
   balance. If it does not, something is missing or doubled.

Rows dated before the earliest pay period are refused unless the import is run with
`addEarlierPeriods: true`, which adds the periods to hold them (up to five years back). The
import is all or nothing: one bad row and nothing is saved.

If you delete a transaction that was imported, it stays deleted: later imports skip that
row and say so. To get it back, run the import with `restoreDeleted: true`.

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

**Face or fingerprint unlock.** On a phone with a fingerprint or a face enrolled, the app
offers once to unlock that way. After that the password is only needed if you log out, the
session ends, or every fingerprint and face is removed from the phone. Settings → App lock
turns it on or off. With it on, the app locks after ten minutes without use
(`IDLE_TIMEOUT_MINUTES` on the server), counting time in the background; with it off, it
signs out instead, as the web app does.

Android decides which of the two it accepts, not the app. The sign-in is locked to a key in
the phone's secure hardware, which only opens for biometrics Android rates "strong". On a
phone whose face unlock is strong (Pixel 8 and later, for example) the unlock prompt takes
your face and has the fingerprint sensor ready at the same moment, so the fingerprint is the
fallback without anything to set up. On a phone whose face unlock is the weaker kind, good
only for the lock screen, the prompt offers the fingerprint alone. On a Pixel, face for
apps is under Settings → Security & privacy → Device unlock → Face & Fingerprint Unlock →
Face Unlock → "Verify it's you in apps".

**Against the API on this machine.** A debug build may also use plain HTTP to reach the
development server; a release build never can. Put `https://localhost` in `APP_ORIGINS` in
`.env`, start `npm run dev`, run `adb reverse tcp:8787 tcp:8787`, and connect the app to
`http://127.0.0.1:8787` (an emulator can use `http://10.0.2.2:8787` without `adb reverse`).
`.env.android.example` shows how to build that address in so the app does not ask.
