# Backlog

Things that were mentioned or will be wanted, not yet broken into tasks. Roughly in the
order they are likely to matter.

## Accounts

The places money lives or goes: savings accounts, other checking accounts, people you send
money to. (Not to be confused with recurring items, which the original brief called
accounts.)

- An Accounts page in the side panel: a list with name, type (savings, checking, person,
  other) and notes.
- A transaction can optionally point at an account ("sent to Savings 1"), chosen in the
  add/edit dialog; so can a recurring item, so the generated transactions inherit it.
- Later, possibly: per-account history, and balances for accounts you own.
- Open questions when this is picked up: whether a transfer is one transaction or a linked
  pair, and whether accounts carry a balance at all.

## Deployment

The app can't be used from a phone until it runs somewhere reachable over HTTPS.

- Dockerfile (Node 22 slim, `npm ci`, `npm run build`, `npm start`) with `data/` as a
  volume.
- HTTPS in front (Caddy, a tunnel, or a private network with certificates);
  `TRUST_PROXY=true` and `APP_ORIGINS` set to the public origin.
- Backups of the SQLite file (`VACUUM INTO` on a timer, or Litestream).
- Bundle the server for production instead of running it through `tsx`.

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

## Recurring items and transactions

- When editing a recurring item, optionally apply the new amount or date to its upcoming
  transactions in periods that already exist.
- Skip or snooze a single occurrence.
- Categories or tags, and filtering by them.
- Splitting an occurrence that is paid in two parts.
- Search across all transactions by name.
- CSV export, and import from a bank export.

## Platform

- Installable PWA with an offline shell.
- Email verification and password reset (needs a mail provider).
- Currency and locale settings (everything is USD / en-US today).
- iOS through the same Capacitor project.
- Component tests for the client (Vitest + Testing Library + jsdom).
- Linting and formatting in `npm run check`.
