# Backlog

Things that were mentioned or will be wanted, not yet broken into tasks. Roughly in the
order they are likely to matter.

## Accounts

The places money lives or goes: savings accounts, other checking accounts, people you send
money to. (Not to be confused with bills and income, which the original brief called
accounts.)

- An Accounts page in the side panel: a list with name, type (savings, checking, person,
  other) and notes.
- A transaction can optionally point at an account ("sent to Savings 1"), chosen in the
  add/edit dialog; so can a bill or income, so the generated transactions inherit it.
- Later, possibly: per-account history, and balances for accounts you own.
- Open questions when this is picked up: whether a transfer is one transaction or a linked
  pair, and whether accounts carry a balance at all.
- The owner's own other accounts (savings, the joint account, a loan) are covered since
  2026-10-12 by *transfers*, a third kind of bill or income with a worked-out balance
  ([phase 15](phase-15-transfers.md), decision 14). What is left for Accounts is people
  you send money to, a page of its own, transfers between two tracked accounts, and
  balances that are reconciled. When it is built, the transfer items are its first rows:
  move them rather than keeping two ways to say the same thing.

## Advice: debts and paying them down

Follows [phase 22](phase-22-advice.md). Bills and income would carry more about a debt: a
credit card's or loan's balance, its interest rate (APR), the minimum payment, and the
statement and due days. Then an Advice question such as "How much should I pay on each
one to pay this down fastest?", answered by working out avalanche (highest rate first)
and snowball (smallest balance first) plans on the server against what each pay period
can spare, and having the model explain the better one. As with the rest of Advice, the
server does the arithmetic; the model explains it.

## Advice: balances over time and concerns

Needs the above, or Accounts. Record the balance of each card, loan and savings account
over time (entered by hand, read from a statement screenshot, or worked out for
transfers), so a question like "Where are my biggest concerns?" can point at a card whose
balance keeps climbing ("stop using the Visa"), savings being drawn down, or a minimum
payment that no longer covers the interest.

## Deployment

Done: `Dockerfile`, `compose.yaml`, `deploy/` and `docs/deploy.md` (Docker Compose with a
restart policy, health check, optional bundled Caddy and optional autoheal; backups with
`VACUUM INTO`). Written without Docker available on the development machine: the image's
file layout and start command were exercised directly, but the first real
`docker compose up --build` on the server is the first time the Dockerfile itself runs.

Still open:

- Bundle the server for production instead of running it through `tsx` (smaller image,
  faster start). Node 22.18+ can also run the TypeScript directly once the few classes
  that use constructor parameter properties are rewritten.
- Continuous replication of the database (Litestream) rather than periodic snapshots.
- Publishing a prebuilt image instead of building on the server.

## Sign in with Google

- New table `user_identities (id, user_id, provider, subject, email, created_at)`, unique
  on `(provider, subject)`.
- OAuth 2 authorization-code flow with PKCE, handled on the server; the callback creates
  the same kind of session as password sign-in.
- First Google sign-in with an email that matches an existing account must **not** link
  automatically. Require the user to sign in with their password and link from Settings,
  or confirm through a signed-in session.
- Settings gains "Connected accounts": link, unlink (blocked if it would leave the account
  with no way to sign in).
- Users created through Google have no password; make `password_hash` nullable and let
  them set one later.

## Passkeys

WebAuthn registration and sign-in (for example with `@simplewebauthn/server` and
`@simplewebauthn/browser`). Works in the browser and, with Digital Asset Links configured,
inside the Android app. Complements rather than replaces the biometric unlock in phase 8.

## More schedules

- **Semi-monthly** (for example the 1st and 15th, or the 15th and last day).
- **Custom rules** such as "monthly on the first Tuesday".
- **Changing the schedule later**: add a second `budget_schedules` row effective from a
  given `seq`; periods already reference `schedule_id`, so existing ones stay as they are.
  The unique-per-user constraint on schedules is dropped at that point.
- Month-based "period" for people who do budget monthly is already covered by `monthly`.

## Bills and income, and transactions

- When editing a bill or income, optionally apply the new amount or date to its upcoming
  transactions in periods that already exist.
- Skip or snooze a single occurrence.
- Categories are planned as [phase 18](phase-18-categories.md). Left here from it: a page
  of one category's transactions, filtering and searching by category, the import
  suggesting a category, and showing limits on the home screen before they are passed.
- Splitting an occurrence that is paid in two parts.
- Search across all transactions is [phase 19](phase-19-search.md). Left from it: capitals
  of accented letters, and searching by amount.
- CSV export, and import from a bank export.

## Reports

Built as [phase 20](phase-20-reports.md). Still only ideas: what a future period will
start with, worked out without creating anything (`phase-10-projections.md`, planned and
then dropped); a period's projected leftover set against how it really ended, which needs
the projection to be recorded when the period closes; exporting a report.

## Platform

- Installable PWA with an offline shell.
- Email verification and password reset (needs a mail provider).
- Currency and locale settings (everything is USD / en-US today).
- iOS through the same Capacitor project.
- Component tests for the client (Vitest + Testing Library + jsdom).
- Linting and formatting in `npm run check`.
