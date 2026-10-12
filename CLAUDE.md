# Pay Period Budget

A budgeting app organised around pay periods instead of calendar months. React single-page
app + small JSON API over SQLite. The same client build will later be wrapped with Capacitor
for Android.

**Picking this project up in a new session? Read `docs/plan/HANDOFF.md` first**: current
state, what is left, what has to be installed, and how the owner likes to work.

Running, configuring and deploying it: `README.md` and `docs/deploy.md`.

The roadmap, domain rules and task breakdown live in `docs/plan/`. Read
`docs/plan/README.md` before starting any feature work, and `docs/plan/domain.md` before
touching periods, transactions or recurring items.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API on :8787 (`tsx watch`) + Vite on :5173, which proxies `/api` |
| `npm run check` | Typecheck + all tests. Must pass before a task is done |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:generate -- --name <what_changed>` | Create a migration after editing `src/server/db/schema.ts`. Read the SQL it writes: it has dropped `ON DELETE` from a foreign key added to an existing table before |
| `npm run db:seed` | Create the local dev account (see `src/server/scripts/seed.ts`) |
| `npm run build` / `npm start` | Build the client; run the API in production mode serving it |
| `npm run db:backup -- <file>` | Write a consistent copy of the database |
| `npm run build:android` | Build the client into `dist/android`, then copy it into `android/`. `.env.android` may give it a server address to start with |
| `npm run open:android` | Open `android/` in Android Studio |
| `npm run build:mcp` | Build the MCP server into one file, `dist/mcp/ppb-mcp.mjs` |

Migrations are applied automatically when the server (or a test) opens the database.
The dev database is `data/app.db` (gitignored); delete the `data/` folder to start clean.

## Layout

```
src/shared/   Code used by both sides: zod schemas, API types, pure domain logic. No I/O, no Node or DOM APIs.
src/server/   Hono API
  app.ts        builds the app from its dependencies (what tests drive)
  index.ts      process entry point
  routes/       HTTP only: parse input, call a service, shape the response
  services/     business rules; depend on repo interfaces, never on drizzle
  repos/        data-access boundary: types.ts = interfaces, sqlite/ = implementation
  db/           drizzle schema, migrations, connection
  middleware/, lib/
  testing.ts    createTestApp(): real app + temp SQLite file + fake clock + cookie client
src/client/   React app
  router.tsx    all routes
  features/<name>/   screens, hooks and components for one feature
  components/ui/     shared presentational primitives
  lib/api.ts    the only place that calls fetch
mcp/          MCP server an AI assistant runs locally; talks to the API with an API token.
              tools.ts = the tools (plain functions), api.ts = its only route to the API
android/      Capacitor's Android project. Generated once, then edited by hand; committed
```

## Rules that keep the codebase consistent

**Server**
- Only `src/server/repos/sqlite/` and `src/server/db/` import drizzle or the driver. Add a
  method to the interface in `repos/types.ts`, implement it, then use it from a service.
  This boundary is what lets the database be swapped later.
- Every repo method that reads or writes user data takes `userId` and filters by it. A
  record belonging to someone else is a 404, never a 403.
- Multi-step writes go through `store.transaction(async (repos) => ...)`. Inside the
  callback use only that `repos` argument: touching `store` there, or nesting another
  transaction, throws. A service function that must run inside a caller's transaction
  takes `repos` as its first parameter. Keep transactions short; all database access is
  queued behind an open one.
- Validate request bodies with a zod schema from `src/shared/` via `parseJson`. Throw
  `AppError` for anything the client should see; never build error JSON by hand.
- Take the current time from the injected `now()`; never call `new Date()` / `Date.now()`
  in services or routes. Tests control the clock.
- New routers mount in `app.ts`, take the shared `authed` middleware and apply it with
  `routes.use(deps.authed)`, as `routes/periods.ts` does.

**Data conventions**
- IDs: `crypto.randomUUID()` text. Instants: integer milliseconds (`timestamp_ms`).
- Money: integer cents, signed (expenses negative, income positive). No floats, ever.
- Calendar dates: `"YYYY-MM-DD"` text. Date-times of transactions: `"YYYY-MM-DDTHH:mm"`
  local wall-clock text. Do date math with the helpers in `src/shared/dates.ts`, not with
  `new Date(string)`.

**Client**
- Server state lives in TanStack Query; talk to the API only through `lib/api.ts`.
- Forms use react-hook-form with the shared zod schema; map server field errors with
  `applyApiError`.
- Style with the semantic colour utilities defined in `styles.css` (`bg-surface`,
  `text-muted`, `border-border`, `bg-primary`, ...). No raw palette classes like
  `bg-green-600`; they break dark mode.
- Give every CSS grid an explicit column count, including the one-column case
  (`grid-cols-1 xl:grid-cols-2`). Without it a long unbroken value widens the column past
  the screen on phones.
- Every screen must work from 360px wide up to ultrawide. Touch targets are at least 44px
  (`min-h-11`). Inputs use 16px text so mobile browsers don't zoom.
- The Android app runs this same client. Branch on `isNative` from `lib/platform.ts`, and
  keep anything only the app needs (Capacitor plugins) in `lib/nativeShell.ts`, which a
  browser never downloads. The session token is touched only through `lib/sessionStore.ts`,
  and the server's address only through `lib/serverUrl.ts` (the app asks for it at first run).
- Inside authenticated routes get the user with `useCurrentUser()`.
- "Today" on the client is `todayIn(budget.timezone, new Date())` using `useBudget()`, never
  the device's own date.
- Build screens from the primitives in `components/ui/` (`Button`, `IconButton`,
  `TextField`, `Dialog`, `Card`, `PageHeader`, `EmptyState`, `Fab`, `useToast`, ...) before
  writing new markup. `/dev/ui` on the dev server shows them all; add new ones there.
- A page inside the shell returns a fragment whose children sit directly in the page
  column: `<PageHeader>` first, `<Fab>` (if any) last.
- In a `Dialog`, mark the field to focus with `data-autofocus`, not `autoFocus`.

**Tests**
- Colocated `*.test.ts`. API behaviour is tested through `createTestApp()` and its
  cookie-keeping client; pure logic in `src/shared/` gets table-driven unit tests.
- Every endpoint that touches user data needs a test proving another user can't reach it.

**Dependencies**
- Do not add packages that compile native code on install (`better-sqlite3`, `bcrypt`,
  `sqlite3`, ...). They fail wherever a working compiler toolchain is missing, which is
  what killed the previous version of this project, and the Docker image has none.
  Prebuilt-binary packages (`@libsql/client`, `@node-rs/argon2`) are fine.
- Ask before adding any dependency a plan task doesn't name.
- `dependencies` in `package.json` is exactly what the server imports at runtime (plus
  `tsx`, which runs it). Everything that is bundled into the web client, and all tooling,
  goes in `devDependencies`. The Docker image installs only `dependencies`.

## Other notes

- Relative imports include the file extension (`./thing.ts`, `./Thing.tsx`). No path aliases.
- In development the API listens on `API_PORT` (default 8787), not `PORT`; tooling sets
  `PORT` for the web dev server.
- Run the Capacitor CLI as `npm run cap -- <command>`. Plain `npx cap` cannot load
  `capacitor.config.ts` with TypeScript 7 installed.
- The Android build needs a JDK 21. Gradle 8.14 (what Capacitor 8 ships) fails on Java 25
  with "Unsupported class file major version 69".

- Recurring bills and income are **recurring items** (`recurring_items`, `/api/recurring`,
  `features/recurring`). Never name them "accounts": that word is reserved for a future
  feature (savings accounts, payees) described in `docs/plan/backlog.md`.
- Folders next to this one are unrelated projects. Do not read from or modify them.
- Commit only when asked.
