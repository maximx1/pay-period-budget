# Phase 11: API tokens, bulk import and an MCP server

**Goal:** an AI assistant on the owner's machine can read and change the budget on the
deployed server without ever holding the account password, and a year of bank history can
be loaded in one go, checked before it is written and safe to run twice.

**Depends on:** phase 8.1 (bearer sessions). The server must be deployed before 11.5 can be
tried against anything real. **Suggested model:** Opus for 11.1 and 11.4 (credentials, and
a bulk write through the carry-forward rules); Sonnet for the rest.

**Status:** planned 2026-10-11 at the owner's request. 11.1 to 11.6 done the same day;
11.7 (history further back than a year) not started.

## Approach

Three pieces, each useful without the next:

1. **API tokens.** Named, revocable keys created in Settings and shown once. A token can
   use the budget endpoints and nothing that manages the account.
2. **A bulk import endpoint** taking JSON, with a dry run. The server never parses a bank's
   CSV: every bank's file is different, and turning one into rows is the job of whoever
   holds the file (an assistant now, an upload page later). Both end at this endpoint.
3. **A local MCP server**: one bundled JavaScript file, run by the assistant over stdio,
   configured with the server's address and a token.

### Why not just a CSV upload page

An upload page still needs everything in 11.4 behind it, plus column mapping, a preview
screen and a matching step, and it would be built for one bank's layout. The hard part of
the migration is judgment, not transport: which bank rows are the recurring bills the app
already generated, what to call "POS DEBIT 4417 KROGER #512", which rows are transfers.
That is what the assistant is for. The page can come later on top of the same endpoint
(`backlog.md` already lists import from a bank export).

### Why the import takes a file, not rows typed by the model

A year of transactions is one or two thousand rows. A model that passes them through its
own output, one tool call or one large argument at a time, is slow, costs a lot, and can
mistype an amount without anyone noticing. Instead the assistant writes a small script
that converts the bank's CSV into a JSON file, and the MCP tool is given the **path**. The
numbers go from the bank's file to the API through code. This is also why the MCP server
runs locally: a hosted one could not read the file.

### Why separate tokens rather than reusing sessions

A session is a signed-in device: it slides forward 30 days at a time, is ended by a
password change, and can do everything the owner can, including changing the password. A
token for an assistant should be named, limited to budget data, optionally read-only,
optionally expiring, and revocable on its own.

## Decided with the owner (2026-10-11)

1. **Where the data goes.** The budget's first period starts on the payday at the end of
   December 2025. Everything from then on is imported first. Those rows land in period 0
   and later, so they move every later starting amount, including today's. That is the
   intent: the opening balance is the bank balance at the start of that payday (before
   that day's own transactions, since they are imported too), and once the import is
   complete the current period's "leftover so far" should equal the bank's posted balance.
2. **Imports are routine, not a one-off.** The bank has no API, so every few days the
   owner downloads a CSV and an assistant imports what is new. Exports overlap, so the same
   row will be offered many times: import keys have to come out the same on every run (see
   the runbook in 11.6), and the possible-duplicates report is used every time, mostly to
   match bank rows to upcoming transactions the app already holds.
3. **Three or four years of older history may follow later.** Today an earlier period can
   only be added up to a year back, which from October 2026 reaches October 2025. Task 11.7
   lifts that. It is not needed for the first import.
4. **A password change revokes every API token.**
5. **Read-only tokens are in.**
6. **The assistant matches, the server only points.** Bank rows that are the same payment
   as an existing transaction (usually a generated recurring one) are left out of the file
   and the existing transaction is updated instead: real date, real amount, paid. The dry
   run lists likely matches (11.4) and merges nothing by itself.
7. **The MCP server uses `@modelcontextprotocol/sdk`**, the official TypeScript library
   for the protocol, as a development dependency bundled into the one MCP file. It never
   reaches the Docker image. Check its current version when installing (11.5).

## Tasks

### 11.1 API tokens on the server

- [x] Done

**Files:** `src/server/db/schema.ts` + migration, `src/server/repos/types.ts`, new
`src/server/repos/sqlite/apiTokens.ts`, `src/server/repos/sqlite/index.ts`,
`src/server/lib/tokens.ts`, `src/server/services/auth.ts`,
`src/server/middleware/session.ts`, `src/server/http.ts`, `src/server/routes/auth.ts`,
`src/server/app.ts`, `src/shared/auth.ts`, tests beside each.

- Table `api_tokens`: `id`, `user_id` (cascade), `name`, `token_hash` (unique),
  `hint` (the last four characters, for telling tokens apart in the list),
  `scope` (`read` | `write`), `created_at`, `last_used_at` (nullable),
  `expires_at` (nullable: never).
- The token is `ppb_` followed by 32 random bytes in base64url. Only its SHA-256 is stored,
  as for sessions. The prefix tells the middleware which table to look in and lets a secret
  scanner recognise a leaked one.
- `requireAuth` accepts a token in `Authorization: Bearer`. It sets `c.var.user` as now and
  records how the request was authenticated (`session` with its id, or `token` with its id
  and scope). `last_used_at` is updated at most once an hour, like `lastSeenAt`.
- What a token may do:
  - `read`: `GET` only. Any other method is a 403 (`forbidden`).
  - `write`: every budget, period, transaction, recurring and settings endpoint.
  - Neither may call `/api/auth/*` other than `GET /api/auth/me`. Changing the password,
    listing or ending sessions and managing tokens need a signed-in session; a token gets
    a 403. A stolen token must not be able to mint another or lock the owner out.
- `GET /api/auth/tokens` → `{ tokens }` (never the secret),
  `POST /api/auth/tokens { name, scope, expiresInDays? }` → the token, once,
  `DELETE /api/auth/tokens/:id`. At most 10 per user.
- Changing the password deletes the user's tokens.
- The origin guard and CORS need nothing: a non-browser client sends no `Origin`.

**Tests:** a token reads and writes budget data; a `read` token is refused on a write; a
token is refused on password change, sessions and token management; an expired or revoked
token is a 401; the secret is returned only by the create call; another user cannot list or
delete a token (404); a password change revokes them. Break the account-endpoint rule on
purpose once and see a test fail.

### 11.2 Tokens in Settings

- [x] Done

**Files:** new `src/client/features/settings/ApiTokensSection.tsx`,
`src/client/features/settings/api.ts`, `SettingsPage.tsx`.

- A section listing tokens: name, access, hint, created, last used, expires; "Revoke" on
  each with a confirmation.
- "New token" dialog: name, access (read only / read and write), expiry (30 days, 90 days,
  1 year, never). On success the dialog shows the token once with a copy button and says
  plainly that it cannot be shown again.
- Check at 375px and 1280px, light and dark. The token is a long unbroken string: make
  sure it wraps rather than widening the dialog.

### 11.3 Reading transactions by date

- [x] Done

**Files:** `src/server/routes/transactions.ts`, `src/server/services/transactions.ts`,
`src/shared/transactions.ts`, `domain.md` (API list), tests.

- `GET /api/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ transactions }` in display
  order, using the existing `listInRange`. The span may not exceed 366 days. Creates
  nothing.
- Today transactions can only be read one period at a time through `PeriodView`. An
  assistant matching bank rows against what exists needs a range.

**Tests:** correct range, inclusive at both ends; a span that is too long or back to front
is a field error; another user's transactions never appear.

### 11.4 Bulk import

- [x] Done (see the implementation notes: the response and the duplicate rule differ from the text below)

**Files:** `src/server/db/schema.ts` + migration, `src/server/repos/types.ts`,
`src/server/repos/sqlite/transactions.ts`, new `src/server/services/import.ts`,
`src/server/routes/transactions.ts`, `src/server/app.ts` (body limit for this route),
`src/shared/transactions.ts`, `domain.md`, tests.

`POST /api/transactions/import`:

```ts
{
  dryRun?: boolean,              // default false
  addEarlierPeriods?: boolean,   // default false
  transactions: Array<{          // 1 to 500
    name, amountCents, kind, occursAt, note?, paid?,   // exactly as POST /api/transactions
    importKey?: string,          // up to 100 characters
  }>,
}
```

- New nullable column `transactions.import_key`, unique on `(user_id, import_key)`. A row
  whose key already exists is skipped and reported, so running the same file twice adds
  nothing. Read the generated migration: `drizzle-kit` has dropped `ON DELETE` before.
- All or nothing: if any row fails validation, or is dated outside what periods allow,
  nothing is written and the errors name the rows (`transactions.17.occursAt`). The same
  key twice in one request is a validation error.
- Rows dated before the earliest period are rejected unless `addEarlierPeriods` is set, in
  which case the missing periods are added first, within the existing one-year limit.
  Adding them materialises recurring occurrences as usual; the response says how many
  periods were added so the caller knows to look for duplicates.
- One `store.transaction`. Look each period up once, sum the rows per period, and apply one
  leftover delta per period in ascending `seq`, rather than one walk per row. Rows sharing
  an `occursAt` take consecutive `sortOrder` after whatever is already there.
- `dryRun` runs the same code and rolls the transaction back, so the preview cannot
  disagree with the real thing.
- Response: `{ dryRun, created, skipped: [{ index, importKey }], periodsAdded,
  periods: [{ id, startDate, endDate, count, netCents }],
  current: { projectedBeforeCents, projectedAfterCents } }`. The last pair is the answer to
  "what does this do to today's number".
- It also returns `possibleDuplicates: [{ index, existing: Transaction, reason }]`: for
  each incoming row, any transaction already stored (or earlier in the same request) with
  the same signed amount dated within three days of it. `reason` says whether the existing
  one is a generated recurring occurrence, which is the common case. This is a report
  only. Rows listed here are still imported on a real run; the caller removes the ones it
  agrees are duplicates and updates the existing transaction instead.
- The API-wide body limit is 100 KB; 500 rows can exceed it. Give this route its own limit
  (512 KB) without loosening the others.

**Tests:** the result equals creating the same rows one at a time (starting amounts match
to the cent), for rows before period 0, after it, and across a manual starting amount; a
dry run leaves the row and period counts unchanged and reports the same figures as the
real run; a second run is all skips; one bad row writes nothing; a `read` token is refused;
another user's `importKey` does not collide; a row matching an existing transaction's
amount within three days is reported as a possible duplicate, one four days away is not,
and another user's transactions are never reported.

### 11.5 The MCP server

- [x] Done (the file list and two behaviours differ; see the implementation notes)

**Files:** new `mcp/` (`server.ts`, `client.ts`, `tools.ts`, `vite.config.ts`, tests),
`package.json` (`build:mcp`, the dev dependency), `.gitignore` if needed.

- Stdio transport. Built with Vite (already installed) into a single file,
  `dist/mcp/ppb-mcp.mjs`, with the SDK bundled in, so installing it is copying one file and
  nothing has to be `npm install`ed where it runs. It imports the zod schemas from
  `src/shared/`, so a tool and the endpoint behind it validate identically.
- Configuration by environment: `PPB_URL` and `PPB_TOKEN`. On start it calls
  `GET /api/auth/me` and fails with a clear message if the address or token is wrong.
- Tools, each a thin call to one endpoint:

  | Tool | Does |
  | --- | --- |
  | `get_budget` | schedule, time zone, today's date in that zone |
  | `list_periods` | every period with its dates and starting amount |
  | `get_period` | by id, by date or `current`: totals and transactions |
  | `list_transactions` | by date range (11.3) |
  | `create_transaction`, `update_transaction`, `delete_transaction` | one at a time; update covers marking paid |
  | `list_recurring` | recurring items |
  | `import_transactions` | `{ file, dryRun = true, addEarlierPeriods = false }`: reads the JSON file, validates every row locally and reports problems by row number, then sends it in requests of 500 |

- Results are compact text with money shown both ways (`-5412` and `-$54.12`), so the
  model does not do cent arithmetic in its head.
- `import_transactions` defaults to a dry run. Requests are separate transactions, so a
  failure part-way leaves earlier chunks written; import keys make running it again safe,
  and the tool's result says exactly how far it got.
- Tool descriptions carry the rules a caller must know: amounts are positive cents with a
  `kind`, dates are wall-clock in the budget's zone, history rows should set `paid: true`.

**Tests:** drive the tool handlers against `createTestApp()` with a real token: each tool
round-trips, a bad token fails at start-up, an import file with a bad row sends nothing.

### 11.6 Documentation and the import runbook

- [x] Done, in `README.md` rather than a new `docs/mcp.md` (see the implementation notes)

**Files:** new `docs/mcp.md`, `README.md`, `CLAUDE.md` (layout and commands),
`domain.md` (API list, the `import_key` column), `HANDOFF.md`.

- Installing: create a token in Settings, build the file, register it
  (`claude mcp add ppb --env PPB_URL=… --env PPB_TOKEN=… -- node /path/to/ppb-mcp.mjs`).
  Say where the token ends up (the assistant's configuration file, in plain text) and that
  revoking it in Settings is the remedy if that file leaks.
- A runbook the importing assistant can follow on its own:
  1. `get_budget`, `list_periods`, `list_recurring`: learn the zone, the date range that
     exists and what the app already generates.
  2. Read the bank file's header and a sample; write a script that converts it to the
     import JSON, and keep the script so the next run reuses it. Never retype amounts.
     Skip pending rows: only posted ones are stable.
     Derive `importKey` from the bank's own transaction id if the file has one. Otherwise
     use date + signed amount + description + a counter among rows identical in all three
     (first, second, …, in the file's order). The counter only comes out the same next
     time if every export contains whole days, so start each download a few days before
     the last import rather than on it.
  3. Dry run. For each entry in `possibleDuplicates`, decide whether it is the same
     payment. If it is, take the row out of the file and update the existing transaction
     (real date, real amount, paid). Ask the owner about the ones that are not obvious.
  4. Dry run again. Show the owner the per-period totals and the change to today's
     projected figure. Import only when told to.
  5. Afterwards compare the current period's "leftover so far" with the bank balance.

### 11.7 History further back than a year (later; independent)

- [ ] Done

**Files:** `src/shared/schedule.ts` (`earliestSeq`), `src/server/services/periods.ts`,
`domain.md` ("Periods before the budget began"), `README.md` (decision 12), tests.

- The one-year limit on earlier periods is a single function, `earliestSeq`. Raise it to
  five years. Nothing else in the rules depends on the number: periods before the budget
  are worked backwards from period 0 whatever their count.
- Four years of biweekly periods is about a hundred rows. Check what that does to
  `GET /api/periods`, to the go-to-date dialog, and to a change in a period before the
  budget, which rewrites the starting amount of every earlier one.
- Adding a period materialises recurring occurrences due in it. Items first due in 2026
  produce nothing there; an item with an old first due date would back-fill years of
  upcoming transactions. The import's `periodsAdded` count is the cue to look.

## Implementation notes

### 11.1 (2026-10-11)

Built as specified. What the next task needs to know:

- **Two middlewares.** `requireAuth` (the shared `authed`) accepts a session or an API
  token. `requireSession` accepts a session only and answers a token with 403. In
  `routes/auth.ts` everything except `/me` uses `requireSession`. A new endpoint that
  manages the account must use it too; a new budget endpoint just takes `authed`.
- **`c.var.sessionId` is not set for a token request.** Only read it behind
  `requireSession`.
- **The read-only rule is by HTTP method**, in the middleware: a `read` token may send
  `GET`, `HEAD` and `OPTIONS`. So it cannot call `POST /api/periods/locate` or
  `POST /api/recurring/preview` even though the second writes nothing, and
  `GET /api/periods/current` still generates today's period for it. Neither seemed worth
  a per-route exception.
- **The secret** is `ppb_` + 43 base64url characters. A session token can start with the
  same four characters about once in 17 million, so a `ppb_` bearer that matches no API
  token falls through to the session lookup instead of being refused outright.
- A token is accepted only in the `Authorization` header, never in the session cookie.
- **Expired tokens are not purged.** They are refused but stay in the list (and count
  towards the limit of 10) until revoked, so the Settings list can show "expired" rather
  than have a token vanish. `expiresInDays` may be left out or null for no expiry; the
  maximum is 3650.
- `POST /api/auth/logout` with a token does nothing to the token. Revoking is
  `DELETE /api/auth/tokens/:id` from a session.
- The create response is `{ secret, token }`: `ApiTokenCreatedResponse` in
  `src/shared/auth.ts`, next to `apiTokenInputSchema` for the form in 11.2.
- The test client's `patch` and `put` now take headers like the others.
- Checked by breaking each rule once: letting a token change the password, letting a
  token mint a token, dropping the read-only check, keeping tokens on a password change,
  and dropping the user filter from the repo lookup each fail a test in
  `routes/apiTokens.test.ts`.

### 11.2 (2026-10-11)

- `ApiTokensSection.tsx` is the last section on the Settings page, on the web and in the
  Android app alike. The form uses `apiTokenInputSchema` with the expiry as a choice
  (30 days, 90 days, 1 year, never) converted to `expiresInDays` on submit. It defaults to
  read only and 90 days: the least access, with a line under the control saying that
  importing needs read and write.
- Revoking asks in the row itself (Cancel / Revoke), the way deleting a transaction does.
- **A toast is invisible while a dialog is open**: a modal `<dialog>` sits in the top
  layer, above the toaster. Anything that goes wrong inside a dialog has to be said inside
  it. The "couldn't copy" message was first a toast and showed nothing.
- When the clipboard is refused the token is selected and an inline message says to copy
  it by hand. That is the path a page served over plain HTTP takes.
- Changing the password now also refreshes the token list, and the Password section says
  that tokens are revoked.
- Checked in the browser at 1280px and 375px, light and dark: empty list, both validation
  messages, creating, a 55-character name wrapping, the token wrapping inside the dialog,
  cancel and revoke, no sideways scroll at 375px.
- **Not checked:** a successful copy. The preview browser refuses clipboard writes, so only
  the failure path ran. An expired token's "Expired" badge was not seen either; the API
  side of expiry is covered by tests.

### 11.3 (2026-10-11)

- `GET /api/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ transactions }`
  (`TransactionListResponse`), validated by `transactionRangeSchema` in
  `src/shared/transactions.ts`. Both ends are included. The limit is 366 days counting
  both ends, so `2026-01-01` to `2027-01-01` is allowed and one day more is not.
- It reads only. A range that reaches past the generated periods, or before the first
  one, returns what is there and creates nothing.
- **`parseQuery(c, schema)`** in `src/server/http.ts` is new: the query-string counterpart
  of `parseJson`, with the same field errors. Every value arrives as text.
- A zod refinement on an object still runs when a field failed its own `refine`, and then
  compares garbage. The date fields abort on failure (`abort: true`) so a bad `from` is
  reported once, on `from`.
- Each transaction carries `recurringId`, which is how a caller tells a generated
  occurrence from a one-off. `occurrenceDate` (the date it was scheduled for) is not in
  the response; add it to `Transaction` if 11.4's matching needs it.

### 11.4 (2026-10-11)

`POST /api/transactions/import`, in `src/server/services/import.ts`. Types and the request
schema are in `src/shared/transactions.ts` (`transactionImportSchema`,
`TransactionImportResponse`, `PossibleDuplicate`). Where it differs from the task text,
this is what was built:

- **Response.** `periodsAdded` is `{ earlier, later }`, not one number: periods generated
  forwards bring recurring transactions with them just as added earlier ones do.
  `current` carries both figures before and after (`leftover…Cents`, `projected…Cents`)
  and the period's id, and is null only if no period covers today. The status is 200 for
  a dry run and a real run alike.
- **Possible duplicates are narrower than planned, on purpose.**
  - One entry per incoming row at most: the closest existing transaction with the same
    signed amount within `DUPLICATE_WINDOW_DAYS` (3). On a tie the generated recurring one
    wins, then one typed in by hand.
  - Other rows of the same request are **not** compared. A bank does not list a payment
    twice, and two $5 coffees in three days would otherwise be reported every time.
  - An existing transaction that was itself imported has its own key, so a different key
    normally means a different payment. It is reported (`reason: "imported"`) only when
    the date and the name also match, which is what a changed way of making keys looks
    like.
  - Two incoming rows can point at the same existing transaction. The caller sees the
    same `existing.id` twice and decides.
- **`Transaction` now has `importKey`** (null unless imported), so a caller can see which
  rows came from the bank.
- **Reaching dates.** `PeriodService.extendToward(repos, userId, { from, to }, { addEarlier })`
  creates periods toward both ends as far as the limits allow and never fails for a date
  out of reach. The import then checks every row against the periods that exist and
  reports the ones outside, by row. `addEarlier` was split into `addEarlierIn` for this.
- **Dry run** throws a private error inside `store.transaction` to roll it back and
  returns the result it carried. Ids of periods and generated transactions created along
  the way differ between a dry run and the real run; everything else is identical (tested).
- **Carrying** is one `applyLeftoverDelta` per period that received rows. The test that
  matters imports eleven rows for one user and posts the same eleven one at a time for
  another, across two added earlier periods, a hand-set starting amount and two periods
  not yet generated, and compares every period and transaction.
- **Order.** Rows sharing a date and time go after whatever is already there, in the order
  given.
- `paid: true` sets `paidAt` to the time of the import, as creating a paid transaction
  does. The bank's posting date is the row's `occursAt`.
- **Body size.** This path alone accepts 1 MB (`IMPORT_PATH` in `routes/transactions.ts`,
  chosen in `app.ts`); everything else stays at 100 KB. 500 rows with 300-character notes
  is about 200 KB.
- **Fixed on the way: an oversized request was answered with a generic 500.** Hono's body
  limit raises its own error type, which the error handler did not know. It is now a 413
  with the usual envelope ("That request is too large"), on every endpoint.
- New repo methods: `transactions.createMany` and `transactions.findImportKeys`.
  `TransactionRecord` has `importKey`; anything that builds one must set it.
- Rows without an `importKey` are always imported. Only keyed rows are safe to repeat.
- 500 rows import in about 50 ms in the tests.
- Checked by breaking eight rules once each (no carry, a dry run that saves, held keys
  not skipped, order ignoring existing rows, imported rows always reported, a four-day
  window, keys shared between users, out-of-range rows accepted): each fails a test in
  `routes/transactions.import.test.ts`. Also run once as a dry run against the dev server.

### 11.5 (2026-10-11)

`npm run build:mcp` writes `dist/mcp/ppb-mcp.mjs`: one file, about 780 kB, importing only
Node's own modules. `dist/` is gitignored, so it is built where it is used.
`@modelcontextprotocol/sdk` 1.32.1 is a dev dependency.

| File | What it holds |
| --- | --- |
| `mcp/server.ts` | The entry point: reads the settings, checks the token, connects over stdio |
| `mcp/config.ts` | `PPB_URL` and `PPB_TOKEN`, and why a bad one is refused |
| `mcp/api.ts` | The only code that calls the API (`client.ts` in the task text) |
| `mcp/tools.ts` | The nine tools, as plain functions that return text |
| `mcp/format.ts` | How periods, transactions and money are worded |
| `mcp/mcpServer.ts` | Registers the tools with the SDK and turns failures into error results |
| `mcp/vite.config.ts` | The bundle |
| `mcp/tools.test.ts` | Everything above, against `createTestApp()` with a real token |

- **The tools know nothing about MCP.** `createTools(deps)` returns `{ name, description,
  inputSchema, run }` objects; `run` returns the text or throws `ToolFailure` /
  `ApiRequestError`. Tests call `run` directly, and three more go through the SDK's
  in-memory transport to prove the registration.
- Input schemas are the shared zod fields (`transactionInputSchema.shape` and so on) with
  descriptions added, so a tool and its endpoint cannot disagree.
- **Starting up.** A missing or malformed setting, or a token the server refuses, stops
  it with a message on stderr. A server that cannot be reached does **not**: it starts
  and the tools report the problem, so a laptop that was offline for a moment does not
  lose its tools for the session. (The task text said to fail in both cases.)
- **Plain `http://` is refused except to this machine**, since the token would travel
  unencrypted. `PPB_TOKEN` must start with `ppb_`.
- **`import_transactions`**:
  - validates every row locally with `importRowSchema` and reports problems by the row's
    place in the file, counted from 0, before sending anything;
  - sends the file in requests of 500, and **tries every one as a dry run before saving
    any**, so a problem anywhere in the file is found first. A real import of n requests
    therefore makes 2n;
  - refuses to save a file needing more than one request unless every row has an
    `importKey`, because a failure part-way can only be recovered by running it again;
  - merges the pieces into one report. For a dry run, each piece is undone, so periods
    added are the most any one piece needed and today's change is the sum of each piece's
    change; periods are matched by their dates because uncreated ones get a new id each
    time. A test checks the dry-run report of a 1,050-row file against the real one;
  - drops "imported earlier under a different key" matches whose key is in the same file:
    those are rows an earlier request of this import just saved;
  - accepts a file of at most 20,000 rows, as an array or `{ "transactions": [...] }`.
- **`list_periods` gives dates and ids only**, not starting amounts as the task said:
  `GET /api/periods` does not return them. `get_period` does.
- `get_period` with a date never creates a period; it says none covers the date.
- Every result shows money as `-$54.12 (-5412 cents)`. Tools are marked read-only or
  destructive for clients that ask before running them.
- `tsconfig.json` and `vitest.config.ts` now include `mcp/`.
- Checked end to end: the built file was started as a client starts it, against the dev
  server with a one-day token, and answered `initialize`, `tools/list`, `get_budget` and a
  dry-run import over stdio. **Not yet registered with an assistant or pointed at the
  deployed server**; that is the first thing to do in 11.6.

### 11.6 (2026-10-11)

- **Everything is in `README.md`**, under "Using it from an AI assistant (MCP)", at the
  owner's request; there is no `docs/mcp.md`. It covers what leaves the machine, creating
  a token, building, registering, the tools, the import file format and the runbook.
- **The owner uses command-line assistants only**: Claude Code, Hermes Agent and the Cline
  CLI. The README gives the registration for each. The server is stdio only by design;
  do not add an HTTP transport or a hosted version without asking. This is personal
  financial data.
- The registrations follow each tool's documentation as read on 2026-10-11:
  - Claude Code: `claude mcp add --env … --transport stdio ppb -- node <file>`. Options
    go before the name, and something other than `--env` must come last before it.
    Local scope by default; never `--scope project`, which writes the token into a
    committed `.mcp.json`, and this repository is public.
  - Hermes Agent: `mcp_servers:` in `~/.hermes/config.yaml`.
  - Cline CLI: `mcpServers` in `~/.cline/data/settings/cline_mcp_settings.json`.
- **Not verified:** none of the three was installed on the development machine, so no
  registration command was run here. The server itself was driven over stdio by a test
  client (11.5). The first real registration, and the first run against the deployed
  server, are still to do, by the owner.
- `CLAUDE.md` (commands, layout) and `domain.md` (API list, importing, `import_key`) were
  updated as their tasks were done.
