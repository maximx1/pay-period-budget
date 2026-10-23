# Phase 28: Balances

Asked for 2026-10-21 and built the same day on `main`; not yet deployed. Adds migration
`0015`. Rebuild the Android app with it. First of three phases built from one request; [phase 29](phase-29-paydown-advice.md) and [phase 30](phase-30-advice-talk.md)
build on it.

## What the owner asked for

> For the recurring stuff. I think I want to track the account balances for those. We set
> an amount and it have a timestamp associated with that as "last updated" time. Then if
> there is a transaction that goes "paid" or "unpaid" it'll update the account amount. This
> would be nice for keeping a rough guess as to where things are and we could use it to do
> some smart payments later on. (This should track interest rates too)

> I would like it to ask me to update from time to time but I want it throttled. [...] We
> should throttle at like maybe 2-3 in one day. It should just be kind of a queue with a
> semi random update schedule I don't need it to be exactly 2 week rotations or something.
> And I also want a snooze button on it if I'm busy.

> I think this could use another tab on the left side. So that if I am bored or something I
> can see all of the ones that are due for an update and just blast through them in one
> shot. It would have me update the balance and maybe a field for interest [...] there is
> such a thing as variable apr so yeah it makes sense to have both.

## What is there already

- A **transfer** (phase 15) has a balance worked out from its starting balance and every
  paid transaction tied to it. It is never checked against the bank, and has no interest.
- A bill (a loan payment, a credit card payment) has no balance at all.
- The backlog's "Advice: debts" and "balances over time" entries are this phase and the
  next two. They are removed from `backlog.md`.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **On screen it is "Balances"**, a side panel entry after Recurring. Not "Accounts",
   which stays reserved (decision 11). "Debts & savings" was the other candidate. In the
   code: `balance_checks`, `tracksBalance`, `features/balances`.
2. **Any bill or transfer can track a balance; an income cannot.** Tracking starts from the
   Balances page ("Track a balance") or from the item's detail view ("Track its balance"),
   which asks for the balance now and, optionally, the interest rate. (Changed while
   building: the plan put a switch in the recurring item's edit dialog, which is long
   already, and would have tied the bill-or-income create and update to tracking.)
3. **The balance is signed, as a transfer's is: below zero is owed.** The form asks "Owed"
   or "In it" beside a positive amount, so nobody types a minus.
4. **A check is a balance as of a moment.** Each one is kept (`balance_checks`), so there
   is a history to chart and for phase 29's advice to read. "As of" is now by default and
   can be set back, for a statement dated earlier.
5. **The estimate between checks is worked out, never stored:** the latest check, plus
   every **paid** transaction tied to the item that happens after the check's "as of",
   money sent to it raising it and money taken from it lowering it, as for a transfer.
   Marking a payment paid moves the estimate at once; marking it upcoming again moves it
   back. A transaction dated on or before the check is taken to be in the bank's figure
   already, so importing old transactions later does not count them twice.
6. **What happens on the account's own side is not seen.** New charges on a card, a loan's
   interest, a savings account's interest: the estimate drifts by those until the next
   check. That is what the asking is for. The page says "estimated" and shows when the
   last check was.
7. **Interest is an APR kept with each check**, as a whole number of basis points
   (`2499` is 24.99%), optional. Each check form starts with the last rate, so a fixed rate
   is never retyped and a variable one is changed where it is. **The estimate does not add
   interest**; the page shows "about $62 interest a month" beside a debt instead. (Adding
   it was the alternative: closer for a card, wrong for a loan whose payment already
   includes it.)
8. **No turning a transfer's starting balance into a check.** An untracked transfer works
   exactly as now. Turning tracking on for one fills the first check with the balance it
   shows; from then on the checks lead.
9. **How often to ask**: "about every month" by default, chosen in Settings from about
   every 2 weeks, month, 2 months or 3 months, and changeable per item (a retirement
   account every 3 months). After each check the next is set that far ahead **give or
   take a quarter, at random** (a month is 23 to 37 days), so items set up on the same day
   drift apart instead of coming due together.
10. **At most 3 asks a day**, a setting from 1 to 5. Due items wait in a queue, oldest due
    first. A day's asks count everything already handled that day: an item checked on the
    Balances page, or snoozed, uses one of the day's three. So ten set up today come back
    over about a week of asks, not in one sitting.
11. **Where it asks: a card on the home screen**, on today's period only, with each item
    to check (up to the day's limit): name, estimate, and a balance field to type in.
    Buttons per item: **Save**, **Looks right** (records the estimate as a check, for
    something that has not moved), and **Snooze** (tomorrow, in 3 days, or next week). A
    **Not today** on the card snoozes all of them until tomorrow. No phone notifications.
12. **The Balances page** (`/balances`): at the top, **Due for a check**, every due item
    regardless of the daily limit, each with the balance and APR fields and Save, for
    going through them all at once. Below, every tracked item: estimate, owed or in it,
    APR, when last checked and next asked, and the transactions since the check that make
    up the difference. Totals: owed, saved. Tapping one shows its history of checks (a
    small chart and a table, as the reports do). **Track another** lists the bills and
    transfers not yet tracked. The side panel entry shows how many are due.
13. **Turning tracking off keeps the history** and stops the asking. Deleting the item
    deletes its checks.
14. **The assistant can read and record balances** (MCP `list_balances`,
    `record_balance_check`), so a statement can be read into it. Rebuild the MCP file.

## Tasks

### 28.1 Schema and the estimate (server)

- [x] Done

- Migration `0015`: `balance_checks (id, user_id, bill_income_id → bills_income ON DELETE
  CASCADE, balance_cents, apr_bps NULL, as_of "YYYY-MM-DDTHH:mm", created_at)`, indexed on
  `(bill_income_id, as_of)`. On `bills_income`: `tracks_balance` (0), `check_every_days`
  (NULL: the user's), `next_check_on` (date, NULL), `snoozed_on` (date, NULL). On
  `user_settings`: `balance_check_days` (30), `balance_checks_per_day` (3). Read the SQL
  `db:generate` writes: check the `ON DELETE` survived.
- Repo methods with `userId` on each; `estimate` as one query over checks and paid tied
  transactions.
- A pure `nextCheckOn(today, days, random)` in `src/shared/balances.ts` with table tests.
  The service takes an injected `random`, as it takes `now`.
- Tests: the estimate after paid, unpaid and back; a transaction dated before the check not
  counted; a refused income; another user's item is a 404 on every endpoint.

### 28.2 API

- [x] Done

- `GET /api/balances` (every tracked item with estimate, last check, next date, due flag,
  totals, and `asksToday`: the items to ask about on the home screen),
  `GET /api/balances/:billIncomeId` (history), `POST /api/balances/:billIncomeId/checks
  { balanceCents, aprBps?, asOf? }`, `POST /api/balances/:billIncomeId/looks-right`,
  `POST /api/balances/:billIncomeId/snooze { days: 1 | 3 | 7 }`, `POST
  /api/balances/snooze-today`, `PUT /api/settings/balances`.
- `tracksBalance` and `checkEveryDays` on the bill-or-income create and update; turning it
  on requires the first check in the same request.

### 28.3 Starting to track

- [x] Done

- A "Track a balance" dialog: the bill or transfer (or the one it was opened for), Balance
  with Owed / In it, APR (optional), "Ask me to check it" (usual, or one of the four).
  Opened from the Balances page and from an item's detail view (see decision 2).

### 28.4 Balances page and side panel entry

- [x] Done

- As decision 12. Built from `components/ui`; works at 360px; the history chart takes its
  colour from `palette.ts` and offers its table.

### 28.5 The home screen card

- [x] Done

- As decision 11. Only on today's period. Optimistic like marking paid, and invalidates
  `["balances"]` (not under the `period` prefix: it is not period data).

### 28.6 Settings, MCP, docs

- [x] Done

- Settings > Balances: how often, how many a day.
- MCP tools; `npm run build:mcp`.
- `domain.md`: the estimate rule, the queue rule, the endpoints. `README.md` status.

## Not in this phase

Reading a balance from a statement screenshot (the screenshot reader could be pointed at
it later). Charges on a card as their own transactions. Interest worked into the estimate.

## Implementation notes (2026-10-21)

**Server**

- Tracking is its own table, `tracked_balances` (one row per tracked item), not columns on
  `bills_income`: the bill-or-income record, create and update stay as they were, and
  stopping is removing the row. Checks are `balance_checks`. Both cascade with the item and
  the user; `db:generate` kept the `ON DELETE` clauses. Settings are two columns on
  `user_settings`.
- `services/balances.ts`. `estimateFor` is shared with `billsIncome.transactions`, which
  reports the estimate as a tracked item's `balanceCents`. Randomness is injected
  (`AppDeps.random`, fixed at 0.5 in `createTestApp`) like the clock.
- `routes/balances.test.ts`, 11 tests: the estimate after paid, unpaid and paid again; a
  payment dated before the check not counted; savings with money taken out; the rate
  carrying on and a check later than now refused; "looks right"; income refused, tracking
  twice refused, an item kept from becoming an income while tracked; checks kept across
  stopping and starting again; the last check kept; the item's own interval; the daily
  limit over two days with checks, snoozes and "not today"; the totals; and another user
  getting 404 on every endpoint, including with their own item and someone else's check id.
  The file's test app has 365-day sessions, since checks fall due a month apart.
  `shared/balances.test.ts` has the pure rules (jitter bounds, ordering and room, rates).

**Client**

- Balances in the side panel after Recurring (`Landmark` icon). The page: owed and held
  totals, "Due for a check (n)" with a check form for each, then every balance as a card
  that opens its history. The history dialog: balance, last checked, APR, interest a month;
  "Ask me to check it" (usual or one of four); a line chart of the checks and the estimate
  now (from two points); what was paid since the last check; "Add a check", with an
  optional earlier day (that day's close, 23:59); the checks, each deletable while there
  are two or more; Stop tracking, confirmed in place.
- The home card ("Balances to check"), on today's period only, under the summary: each
  item's estimate and a check form with Save, Looks right and Snooze (Tomorrow, In 3 days,
  Next week); "Not today" and "See all balances" at its foot.
- Settings > Balance checks: how often, how many a day.
- The queries live under `["bills-income", "transactions", ...]`, the prefix every
  transaction change already refreshes, so marking a payment paid moves the estimate.
- Forms share `BalanceFields`: the amount as a positive figure with Owed / In it, so nobody
  types a minus, and the APR as a percentage.

**MCP**: `list_balances` and `record_balance_check` (which starts tracking when needed).
The item transactions tool's balance wording now covers a tracked bill. `npm run build:mcp`
was run.

**Checked in the browser** on the demo account at 1280px and 360px: tracked Car payment
($8,450 owed at 6.9%, next asked Nov 24) from the empty page; with Car payment and Savings
made due in the database, the home card listed both; saving a new Car payment balance left
Savings alone on the card; snoozing Savings until tomorrow removed the card. The history
dialog at 360px showed the figures, the chart of two checks and the add form.

Car payment's detail view on the Recurring page offered "Balance history", which opened its
history on the Balances page.

**Not checked:** dark mode (only semantic colours are used); "Track its balance" for an
untracked item (the same dialog the page opens); Android.

## Changing the APR in place (2026-10-22)

The owner couldn't change a rate without retyping the balance, since a new rate came only
with a new check. Now:

- `PATCH /api/balances/:billIncomeId` takes `aprBps` as well as `checkEveryDays`, both
  optional. A rate there changes the latest check's in place (`BalanceRepo.updateCheck`); it
  is not a check, so the estimate's starting point and the next ask don't move.
- The history dialog's APR figure has a pencil that opens an APR field with Save and Cancel.
- The check forms (Add a check, and each "Due for a check" row) follow the last check's
  rate when it changes elsewhere, unless one has been typed into them, so the next check
  doesn't put the old rate back. Add a check also resets from the saved balance after
  Save; it used the one from before the check, and so showed the old rate again.
- MCP: no tool for it yet; `record_balance_check` still records a rate with a balance.

**Checked in the browser** on the dev account at 1280px and 360px: 8.1% to 9.99% from the
pencil, with the interest a month following and no new check in the list; Add a check's APR
then showed 9.99; "1000" was refused with "Enter a rate like 24.99".
