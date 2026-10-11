# Roadmap

Last updated 2026-10-10.

## Goal

A personal budget app built around the pay period. It runs in a browser at any width from
a phone to an ultrawide monitor, exposes a JSON API, and will later ship as an Android app
that wraps the same client.

## Stack and why

| Piece | Choice | Reason |
| --- | --- | --- |
| Client | React 19 + Vite, React Router, TanStack Query, Tailwind 4 | A true SPA that builds to static files. Capacitor can bundle those files into an Android app unchanged. |
| API | Hono on Node | Small, plain HTTP + JSON, easy to test in-process. |
| Database | SQLite through Drizzle + `@libsql/client` | One portable file. libsql ships prebuilt binaries (no compiler needed) and can point at a remote database later. |
| DB boundary | Repository interfaces in `src/server/repos/types.ts` | Services never see Drizzle, so replacing SQLite means writing one new implementation. |
| Auth | Argon2id password hashes; opaque session tokens stored hashed; httpOnly cookie | Sessions can be revoked server-side. Bearer tokens for the Android app reuse the same session table (phase 8). |
| Validation | zod schemas in `src/shared/` | One definition used by the form and the endpoint. |

Next.js was dropped because its static export (what Capacitor needs) cannot include route
handlers, cookies or the proxy layer, so the phone build would have needed a second,
different app.

## Status

| Phase | What | Status | Who |
| --- | --- | --- | --- |
| 0 | Project foundation | Done | n/a |
| 1 | Register, sign in, sessions | Done | n/a |
| [2](phase-02-app-shell.md) | App shell: side panel, routing, UI primitives | Done | n/a |
| [3](phase-03-periods.md) | Budget setup and the period engine | Done | n/a |
| [4](phase-04-transactions.md) | Transactions and the home view | Done | n/a |
| [5](phase-05-recurring.md) | Recurring items (bills and income) | Done | n/a |
| [6](phase-06-period-adjustments.md) | Editing period dates and starting amounts | Ready | Opus, or Sonnet with Opus review |
| [7](phase-07-polish.md) | Manual ordering, settings, polish (date search tabled) | Ready | Sonnet |
| [8](phase-08-android.md) | Android app via Capacitor, biometric unlock | Ready after 7 | Sonnet for 8.1 to 8.3, Opus for 8.4 |
| [Later](backlog.md) | Accounts (savings, payees), Google sign-in, passkeys, more schedules, deploy, iOS | Not planned in detail | n/a |

### What phases 0 and 1 delivered

- Repo layout, tooling and conventions described in `CLAUDE.md`.
- `users` and `sessions` tables with the first migration.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`, `GET /api/health`.
- Security: Argon2id hashing, hashed session tokens, 30-day sliding expiry, httpOnly
  SameSite=Lax cookie, origin check on writes, JSON-only bodies, login and registration
  rate limits, identical responses for wrong password and unknown account, security
  headers and CSP in production.
- Sign-in / create-account screen at `/login` and `/register`, route guards, and a
  placeholder signed-in page at `/` that phase 2 replaces.
- 24 tests covering all of the above.

### What phase 2 delivered

- The signed-in frame: side panel with account summary, navigation and log out; a top bar
  and slide-in drawer below 1024px; a page column capped in width for ultrawide screens.
- Routed placeholder pages for Home, Date search, Recurring and Settings.
- UI primitives: `Dialog` (bottom sheet on phones), `Drawer`, `IconButton`, `Fab`,
  `PageHeader`, `EmptyState`, `Card`, toasts. All shown together at `/dev/ui` on the dev
  server.
- `src/shared/money.ts` and `src/shared/dates.ts` with 104 tests.
- Read the implementation notes at the bottom of `phase-02-app-shell.md` before building
  UI in later phases.

### What phase 3 delivered

- Pay-schedule maths for weekly, biweekly and monthly budgets (`src/shared/schedule.ts`).
- `user_settings`, `budget_schedules` and `periods` tables.
- `GET`/`POST /api/budget`, `GET /api/periods/current`, `GET /api/periods/:id`,
  `POST /api/periods/locate`. Periods are generated on demand, server-side only, up to the
  one containing the day a year from today.
- First-run setup screen, and a home screen showing one period with its leftover figures
  and previous / next / today navigation.
- A queue in the SQLite store that serialises database access (see the phase 3
  implementation notes for why this matters).
- Read the implementation notes at the bottom of `phase-03-periods.md` before phase 4.

### What phase 4 delivered

- `transactions` table and `POST` / `PATCH` / `DELETE /api/transactions`.
- Carry-forward: every change to a period's projected leftover moves the starting amount
  of the periods after it, stopping at one set by hand.
- Home screen: Upcoming and Paid sections with running totals, one-tap paid toggle, a
  floating + button and an add / edit / delete dialog. A transaction whose date moves to
  another period goes there, creating the period if needed.
- Read the implementation notes at the bottom of `phase-04-transactions.md` before phase 5.

### What phase 5 delivered

- Recurrence maths: every n weeks, months or years, or every pay period
  (`src/shared/recurrence.ts`).
- `recurring_items` table and `/api/recurring` (list, create, preview, update, delete, end).
- Occurrences become upcoming transactions when a period is generated and when an item is
  created, exactly once each. Creating an item with a past first due date back-fills
  earlier periods; the dialog previews and warns first.
- Recurring page: filterable card grid, add / edit dialog, end and delete, descriptions
  with clickable links.
- Read the implementation notes at the bottom of `phase-05-recurring.md` before phase 6.

## How to work a task

Each phase file is a list of numbered tasks. A task is sized to be finished in one
sitting and leaves the app working.

1. Read `CLAUDE.md`, then `domain.md`, then the phase file.
2. Do one task. Stay inside its "Files" list unless something there is impossible; if so,
   say why before widening.
3. Write the tests the task lists. `npm run check` must pass.
4. For anything visible, run `npm run dev` and check it in the browser at 375px wide and
   at 1280px or wider, in both light and dark colour schemes.
5. Tick the task's checkbox in the phase file and add anything the next person needs to
   know under "Implementation notes" at the bottom of that file.
6. If a task's instructions contradict `domain.md` or look wrong, stop and ask rather than
   picking one.

Kick-off prompt for a fresh session:

> Read CLAUDE.md and docs/plan/README.md. Then implement task 6.1 from
> docs/plan/phase-06-period-adjustments.md, following "How to work a task".

Tasks within a phase are ordered; do them in order unless marked "independent".

## Decisions

Gaps in the original brief and how they were settled. Confirmed by the owner on 2026-10-10
unless marked otherwise.

1. **Periods stay contiguous.** When a period's dates change, the neighbour's shared
   boundary always follows, and the dialog previews exactly what will change before you
   confirm. There is no opt-out, because an unadjusted neighbour would mean a day counted
   twice or a day in no period. Only the shared boundary moves; nothing else about either
   neighbour, and no ungenerated future period, is affected.
2. **A period runs from payday through the day before the next payday.** A biweekly budget
   starting Friday Oct 2 has periods Oct 2 to Oct 15, Oct 16 to Oct 29, and so on.
3. **Two leftover figures, and the projected one carries forward.** *Leftover so far* is
   the starting amount plus paid transactions; *projected leftover* adds the unpaid ones.
   The home view shows them together ("$412.10 of $180.55 projected") alongside the paid
   and upcoming totals. The next period starts from the projected figure; if that turns
   out to disagree with the bank, that is the cue to go looking. Upcoming and Paid each
   show a placeholder with an icon when empty.
4. **Income is nothing special.** It is a recurring item (or a one-off transaction) with a
   positive amount. A paycheck can repeat "every pay period", landing on each period's
   first day.
5. **Setup asks for an opening balance** (default 0) that becomes the first period's
   starting amount.
6. **Date search is tabled.** The side panel keeps a placeholder page. Nothing is built
   until what it should do is decided (task 7.1).
7. **A new recurring item appears from the period containing its first due date onward**,
   in every period that already exists. Usually that is only the current period. A first
   due date in the past back-fills earlier periods, which changes their leftover and every
   starting amount after them; the add dialog previews and warns about this (phase 5).
   Editing a recurring item never changes transactions that already exist.
8. **Passwords need 8+ characters.** `npm run db:seed` creates the local stub account.
9. **Usernames and emails are stored lowercase**; sign-in accepts either.
10. **One home time zone per budget.** Dates and times are wall-clock values in the zone
    chosen at setup, wherever the device is; "today" is computed in that zone. Timestamps
    such as created-at are stored in UTC.
11. **"Accounts" is reserved.** What the original brief called accounts (recurring bills
    and income) are *recurring items* in the app and the code. *Accounts* will be a later
    feature: savings accounts, other checking accounts and people you send money to, which
    a transaction can point at. See `backlog.md`.
