# Domain rules

The single source of truth for how periods, transactions, and bills and income behave. Phase files
say what to build; this file says what must always be true.

## Vocabulary

- **Budget schedule**: how a user's periods repeat (weekly, biweekly or monthly) from an
  anchor date.
- **Period**: one span of the budget, from payday through the day before the next payday.
  The home screen shows one period at a time.
- **Transaction**: one payment or one deposit, dated, either *upcoming* or *paid*.
- **Bill or income**: something you pay or are paid, tracked by name: the rent, a credit
  card, a paycheck, money from side jobs. Most have a schedule, and are then a template
  that produces transactions; one with no schedule only gathers the transactions tied to
  it. Income is not special: it is one whose amount is positive. A third kind, a
  **transfer**, is another account of the user's own that money is moved to and may come
  back from (savings, a joint account, a HELOC or other loan); only a transfer has a
  balance, and it is worked out, not stored. On screen the page is "Recurring" and one of them a "recurring item" (decision 15); in the code the table is
  `bills_income` and one of them is a `BillOrIncome`. (They were called *recurring items* in the code
  until 2026-10-12, which older plan files still say. The word **account** is reserved
  for a future feature: the places money lives or goes, such as a savings account or a
  person you pay. See `backlog.md`.)
- **Category**: what a transaction is filed under, by name ("Groceries"). At most one per
  transaction. It moves no money.
- **Limit**: the most a pay period means to spend in one category. A category has a
  *usual limit*; each period has its own copy, which can differ.
- **Starting amount**: what a period begins with. Normally the previous period's projected
  leftover.
- **Projected leftover**: starting amount + every transaction in the period, paid or not.
  This is what carries into the next period.
- **Leftover so far**: starting amount + paid transactions only. If the bank statement
  disagrees with this, something was missed.

## Splits and waiting payments (phase 27)

A **split** spreads amounts due by dates evenly over the pay periods up to them and makes
one ordinary transaction per period. Payments in periods more than a year ahead, which
cannot exist yet, are kept as **waiting payments**, each already worked out in full. They
are added as transactions once their periods are within reach: the home screen offers to
when all of a split's remaining payments can be, or three of them can. A waiting payment
belongs to no period and counts toward no total until it is added.

A split is kept (phase 31): its items, its options and the periods skipped, with each of its
transactions and waiting payments pointing at it and holding each item's share. **Rounding
up** rounds each period's payment (the sum of its shares, never each share) up to a
multiple of $50; the extra goes to the item due soonest, so payments shrink and drop off at
the end. **Adding to** a split or **skipping** a payment works the split out again from a
period on: payments already paid, and any in earlier periods, stay as they are and count for
what they came to; what is left of each item is spread over the open periods to its due
date (not skipped, not holding a kept payment), rounded up if the split says so; unpaid
payments are changed in place, made or deleted to match. Skipping the last payment before
an item is due is refused.

## Value formats

| Kind | Format | Example |
| --- | --- | --- |
| Calendar date (`LocalDate`) | `YYYY-MM-DD` text | `2026-10-16` |
| Transaction date-time (`LocalDateTime`) | `YYYY-MM-DDTHH:mm` text, wall clock, no zone | `2026-10-05T00:00` |
| Instant (created, paid, expires) | integer milliseconds | |
| Money | integer cents, signed; expense negative, income positive | `-2700` |

Both text formats sort correctly as strings, which the queries rely on.

**Time zone.** A budget has one home time zone, chosen at setup and stored in
`user_settings`. Every calendar date and transaction date-time is a wall-clock value in
that zone, wherever the device happens to be: a budget set up in New York still rolls over
to the next period at New York midnight when it is opened in Tokyo. "Today" and "now" are
always computed with `todayIn(zone, now)` / `nowIn(zone, now)`, never from the device's
local clock. Instants (created, paid, session expiry) are stored as UTC milliseconds. All
date arithmetic goes through `src/shared/dates.ts`.

## Budget schedule

Types in scope: `weekly`, `biweekly`, `monthly`. (Semi-monthly and custom rules are backlog.)

A schedule defines **nominal periods** by index (`seq`). Period 0 starts on the anchor.
Negative indexes are the periods before it (see "Periods before the budget began"); the
same formulas give their dates:

- `weekly`: nominal start = anchor + 7 × seq days
- `biweekly`: nominal start = anchor + 14 × seq days
- `monthly`: nominal start = anchor + seq months, clamping the day to the month's length.
  Always add months to the *anchor*, never to the previous start, so an anchor on the 31st
  gives Jan 31, Feb 28, Mar 31 rather than drifting to the 28th.
- nominal end = the next nominal start − 1 day

Setup rules: the anchor date must be today or earlier, and no more than 366 days back.

## Periods

Invariants (must hold after every write):

1. A user's periods are numbered by consecutive `seq` with no holes. Period 0 always exists;
   any before it are −1, −2, ….
2. They are **contiguous**: `period[n+1].startDate = period[n].endDate + 1 day`.
3. Every period is at least one day long.
4. There is always a period containing today (created on demand).

### Generation

Periods are created lazily at the tail by `ensureThrough(userId, date)`, and one at a time
at the head by `addEarlier` (next section). `ensureThrough`:

- Rejects a date before the earliest period's start.
- Rejects a date beyond the **horizon**: the nominal end of the period that contains
  today + 1 year.
- Otherwise creates each missing period in order, inside one transaction:
  - `seq` = previous + 1
  - `startDate` = previous `endDate` + 1 day (so a manually moved boundary is respected)
  - `endDate` = the **nominal** end for this `seq` (so one edited period never shifts the
    rest of the calendar)
  - `nominalStart`, `nominalEnd` = the schedule's values for this `seq`, stored for display
    and "revert"
  - `startingCents` = previous period's projected leftover; `startingMode` = `auto`;
    `carryStale` = previous period's `carryStale`
  - then materialise scheduled occurrences for the new period (see Bills and income)

Generation is always validated and performed on the server. The client only asks for a
period by id, for "current", for "the period containing date X", or for "the one before
the earliest".

### Periods before the budget began

Decided 2026-10-11: **today's numbers stay fixed.** The first period's starting amount is
the truth the user entered at setup. Anything before it is history, and history is worked
*backwards* from that amount.

`addEarlier(userId)` creates the period before the earliest one:

- `seq` = earliest − 1. Rejected ("That's more than 5 years back") below `earliestSeq`: the
  nominal period containing today − `MAX_HISTORY_YEARS` (5). History reaches further back
  than the horizon reaches forward, because a bank's records do.
- `endDate` = the earliest period's `startDate` − 1 day (so a moved boundary is respected);
  `startDate` = the nominal start for this `seq`; nominal dates stored as usual.
- scheduled occurrences due in it are materialised, like any new period;
- `startingCents` = the next period's `startingCents` − the net of the transactions in it.

The invariant for every period with `seq` < 0:
**its projected leftover equals the next period's starting amount.** It is kept by:

- A change of `d` in the leftover of the period at `seq` s < 0 (a transaction created,
  edited, deleted or moved; days changing hands): subtract `d` from the starting amount of
  that period and of every period before it. Nothing after it moves. `applyLeftoverDelta`
  does this when given a negative `seq`.
- A change of `d` in period 0's starting amount (set by hand, or reverted): add `d` to the
  starting amount of every period before it (`shiftHistory`).

Periods before the budget are always `auto` and never stale. Their starting amount cannot
be set or reverted (409). Their dates can be edited like any other period's. Only the
previous-period arrow adds them; dating a transaction before the earliest period is still
rejected, and the date search still only finds periods that exist.

### Which transactions belong to a period

Membership is **derived from the date**, not stored: a transaction belongs to the period
whose `[startDate, endDate]` contains the date part of its `occursAt`. There is no
`period_id` column. Consequences:

- Changing a transaction's date moves it to the right period automatically.
- Moving a period boundary moves the transactions that sit on the affected days.

A transaction may only be dated within existing or generatable periods: on save, call
`ensureThrough(date)` and surface its rejection as a validation error on the date field.

### Totals for one period

```
paidCents       = sum of amountCents where status = paid
upcomingCents   = sum of amountCents where status = upcoming
leftoverCents   = startingCents + paidCents                    (leftover so far)
projectedCents  = startingCents + paidCents + upcomingCents    (projected leftover)
```

Totals are computed on read. Only `startingCents` is stored. The home view shows the pair
together, as "`leftoverCents` of `projectedCents` projected". Beside them it shows
**Starting**, **Income** (every positive transaction in the period, paid or not),
**Expenses** (every negative one, as a positive amount) and **Upcoming** (`upcomingCents`),
so that Starting + Income − Expenses = projected. Income and Expenses are added up on the
client from the period's transactions. `paidCents`, a net of both directions, is the Paid
section's own total and is no longer shown in the summary: netted, it read as neither.

### Carrying leftover forward

What carries forward is the **projected** leftover. "Leftover" in the rest of this section
means `projectedCents`.

`startingCents` of each period is stored, so it must be kept in step. Two operations do
all of it:

**`applyLeftoverDelta(userId, afterSeq, deltaCents)`**: walk forward from `afterSeq + 1`.
For each period: if `startingMode = manual`, stop. Otherwise add `deltaCents` to its
`startingCents` and continue. Used whenever a period's projected leftover changes by a
known amount:

| Event | Delta applied after which period |
| --- | --- |
| Transaction created | + amount, after its period |
| Transaction deleted | − amount, after its period |
| Amount edited | (new − old), after its period |
| Date edited across periods | − amount after the old period, + amount after the new one |
| Paid ↔ upcoming | none; leftover is unchanged |
| Period boundary moved (phase 6) | for each transaction that changed period: as "date edited" |

**`recomputeChain(userId, fromSeq)`**: walk forward from `fromSeq`. For each period: if
`startingMode = manual` and it is not the first one visited, stop. Otherwise set
`startingCents` to the previous period's projected leftover (or the opening balance for
`seq` 0), and set `carryStale` to whether that previous period is itself flagged (a manual
one never is). A recalculated amount is only as trustworthy as what it was calculated from.
Used by "revert to calculated" and "recalculate".

Using deltas for everyday changes means a period flagged stale keeps tracking new
transactions correctly while still preserving the discrepancy the user chose not to carry
forward.

### Manual starting amount (phase 6)

- Setting a starting amount by hand sets `startingMode = manual` on that period and clears
  its own `carryStale`. It is pinned: neither operation above overwrites a manual value.
- With **carry forward on**: apply `(new − old)` as a delta after this period.
- With **carry forward off**: change nothing downstream, but set `carryStale = true` on
  every following period up to (not including) the next manual one. Those periods show a
  "may be out of date" marker. (If the typed amount equals the current one there is no
  difference to carry, so nothing is flagged.)
- **Revert**: set `startingMode = auto` and run `recomputeChain` from this period. If the
  period before it is flagged, the reverted amount stays flagged too.
- **Recalculate** (offered on a stale period): run `recomputeChain` from the first stale
  period in that run, found by walking back while the previous period is flagged.
- A period generated after a stale one inherits `carryStale`.

### Editing period dates (phase 6)

See decision 1 in `README.md`; the rules below assume the default.

- A period's start and/or end may be moved. The neighbour's shared boundary moves with it.
- Limits:
  - every affected period stays at least one day long;
  - the new dates must share at least one day with the old ones (a period can't jump clear
    of itself);
  - days a period gives up must have a period to go to, or be empty. If the next period
    doesn't exist yet but is within the horizon, it is generated as part of the change. The
    first period's start can move later, and the last allowed period's end earlier, only
    past days with no transactions;
  - the last allowed period's end must stay before the *following* nominal end.
- `nominalStart` / `nominalEnd` never change. A period is "edited" when its actual dates
  differ from nominal; "revert dates" restores nominal and moves the neighbours back.
- Transactions are not rewritten; they fall into whichever period now covers their date.
  Apply the leftover deltas for those that changed period.
- Ungenerated future periods are unaffected because generation uses nominal ends.

### Low balance warnings

Decided 2026-10-20 (decision 17). The current period warns about the pay periods after it
that are set to end low: a period's **projected leftover** (its "Balance at end of
period") below the user's amount is *low*, and below zero is *negative*, the urgent one.
Exactly the amount is not low; exactly zero is low, not negative.

- **Per user**, in `user_settings`: `low_balance_cents` (default 20000, $200.00; 0 warns only
  below zero) and `low_balance_periods`, how many periods after the current one to look at
  (default 5, at most 10; 0 turns the warnings off). `PUT /api/settings/low-balance`.
- **Which periods**: up to `low_balance_periods` periods after the one containing today.
  The current period itself is not among them: its own card already shows how it ends.
- **Only periods that exist count.** One not generated yet is left out, not worked out
  from the schedules (decided 2026-10-20), so the warnings can cover fewer periods than the
  setting until the user or a dated transaction has gone that far ahead. Each period
  reports its projected leftover as stored and summed, a starting amount set by hand
  included.
- The outlook is worked out on read (`GET /api/periods/outlook`); nothing is stored and
  nothing is created but the current period, which always exists. The home screen shows one
  warning for each level, below zero first, on the current period only; the wording is
  `outlookHeading` and `outlookLine`. The MCP tool `get_balance_outlook` reports the same.

## Transactions

Fields: `id`, `userId`, `name`, `amountCents` (signed), `occursAt`, `status`
(`upcoming` | `paid`), `paidAt`, `sortOrder`, `note`, `categoryId` (nullable), for generated ones `billIncomeId`
and `occurrenceDate`, and for imported ones `importKey`.

- The API accepts a positive amount plus `kind` (`expense` | `income`) and stores the
  signed value. Zero is rejected.
- One-off transactions default to `upcoming` unless created with `paid: true`.
- Marking paid sets `paidAt`; marking upcoming clears it.
- Display order within a section: `occursAt`, then `sortOrder`, then `createdAt`.
  `sortOrder` only matters between transactions with identical `occursAt` (phase 7 adds
  manual reordering; until then it is 0). The API sends that order, oldest first; since
  2026-10-15 the home screen shows each section newest first (`newestFirst`), keeping
  rows at the same moment in their `sortOrder`.
- Deleting is a hard delete.

### Linking to a bill or income

A transaction's `billIncomeId` says which bill or income it belongs to. The app sets it on
the transactions it generates; anyone may also set it on a transaction they enter or
import, to say "this was a payment to that". A linked transaction is otherwise ordinary:
the link moves no money and changes no starting amount.

- `occurrenceDate` is set only on generated transactions. It is how a generated entry is
  told from one linked afterwards.
- `billIncomeId` on create, on update (null unties) and on each import row must name one
  of the user's own items. An unknown id and someone else's are refused in the same words.
- Untying a generated transaction keeps its `occurrenceDate`. Moving it to another item
  clears it: it is no longer the occurrence its first item scheduled.

**Paying toward an upcoming entry.** `countsToward` on create, and on an import row, names
an upcoming transaction a bill or income generated. The new transaction is tied to the
same item, and that entry shrinks by the new transaction's amount; when nothing is left it
is deleted. Paying more than is left finishes it, and the rest is an ordinary payment.

- Paying a part therefore leaves the projected leftover as it was: the amount moves from
  upcoming to paid. Each change is carried forward the usual way, in each one's own period.
- Only an entry that is `upcoming`, generated, of the same item, and in the same direction
  (money out toward money out) can be paid toward.
- Several rows of one import may pay toward the same entry; they are taken in order.
- It is one-way. Changing or deleting the payment later does not bring the entry back.

### Filing under a category

A transaction's `categoryId` names the one category it is filed under, or is null. A
category is a name, unique for its user without regard to case ("Groceries" and
"groceries" are one), and optionally a usual limit (see "Limits").

- `categoryId` on create, on update (null unfiles) and on each import row must name one of
  the user's own categories. An unknown id and someone else's are refused in the same
  words, as a field error.
- **Left out on create or on an import row**, a transaction tied to a bill or income takes
  that item's category, and a payment that `countsToward` an entry takes the entry's.
  `null` says "none". Nothing is taken on update: changing or removing the tie later
  leaves the category as it is.
- A bill or income has a `categoryId` of its own. Every entry it adds is filed under it.
  Changing it changes nothing that exists, like any edit to the item, with one exception
  the caller asks for: `applyToTransactions` on `PATCH /api/bills-income/:id` files every
  transaction tied to the item, generated or tied by hand, under the item's category (or
  under none), replacing whatever each had. The response's `refiledTransactions` says how
  many were filed differently before.
- Filing, refiling and unfiling move no money and change no starting amount.
- Deleting a category is a hard delete. Its transactions and its bills and income stay,
  filed under nothing; its limits go with it.

### Limits

A category's `defaultLimitCents` is its usual limit: null for none, 0 for "spend nothing".
A period's limit for a category is a row of its own (`period_category_limits`), a copy made
once and then independent, the way an entry is a copy of its bill.

**Where a period's limits come from:**

1. **When a period is generated forwards**: one for every category with a usual limit.
2. **Never when a period is added before the earliest** (`addEarlier`, and an import with
   `addEarlierPeriods`): that is history, and limits there are set by hand.
3. **`applyToPeriods`** on creating a category or changing one: the current period and
   every later one that exists (end date today or after) are set to the usual limit,
   replacing what each has, one set by hand included; if the usual limit is null, theirs
   are removed. Without it, nothing that exists changes. Periods that have ended are never
   touched by it.
4. **By hand**: `PUT` and `DELETE /api/periods/:id/limits/:categoryId`, for any period,
   past ones and ones before the budget included.

**What counts against one.** For each limit, over the period's transactions filed under
that category:

```
spentCents      = max(0, −(sum of amountCents))                 paid and upcoming
paidSpentCents  = max(0, −(sum of amountCents where paid))
```

Money in under the category (a refund) lowers what was spent; more in than out is zero,
not negative. Transactions filed under nothing count toward nothing. Spending follows the
transactions' dates like everything else, so moving a period's boundary moves the spending
and leaves the limit where it was.

**Over** means `spentCents > limitCents`; exactly the limit is not over. The wording is
`overLimitMessage` in `src/shared/categories.ts`, used by the home screen and the MCP
server alike: "You went over your budget for X by $Y this period." when the paid spending
alone is over, and "You're set to go over ..." when it is only over with what is upcoming.

Limits are bookkeeping: setting, changing or removing one moves no money and no starting
amount.

### Importing

`POST /api/transactions/import` saves up to 500 transactions in one step, with the same
effect on starting amounts as creating them one at a time.

- **All or nothing.** If any row is invalid, or dated where no period can exist, nothing
  is saved and the error names each row (`transactions.17.occursAt`).
- **`importKey`** is the importer's own name for a row, unique per user. A row whose key
  is already held is skipped, so the same file can be imported again. Rows without a key
  are always added.
- **A deleted import stays deleted.** Deleting a transaction that has an `importKey`
  records the key in `deleted_import_keys`, and later imports skip that row too (reported
  as `skipped` with `reason: "deleted"`, next to `"held"`). `restoreDeleted: true` on an
  import forgets the deletion for the keys in that request and imports them again.
- **Rows before the earliest period** are refused unless `addEarlierPeriods` is set, which
  adds the periods needed, within the usual five-year limit. Rows after the latest period
  generate forwards to the horizon, as a single transaction does.
- **`dryRun`** does the whole import and undoes it. The report is what a real run would
  return.
- **Possible duplicates** are reported, never acted on: for each incoming row, the closest
  transaction already held with the same signed amount and a date within three days. When
  the existing one is an upcoming entry a bill or income generated, the caller's answer is
  `countsToward` on the row: the real payment replaces the expected entry and keeps its
  import key. A row with `countsToward` is not reported.
- **Bill-or-income suggestions** are reported the same way, for rows that name neither a
  `billIncomeId` nor a `countsToward`: at most one item per row, with the reason.
  `occurrence`: the row is a possible duplicate of an upcoming entry an item generated
  (the suggestion carries that entry's id for `countsToward`). `same_description`: a
  transaction already tied to an item has the same note or name, compared without regard
  to case, spacing or punctuation; when two items have shared one, the most recent use
  decides. `name`: the item's name appears in the row's name or note as whole words; the
  longest such name wins. The server never applies a suggestion.

## Bills and income

Fields: `id`, `userId`, `name`, `description`, `kind` (`expense` | `income` | `transfer`),
`openingCents` (signed; non-zero only for a transfer), `defaultAmountCents` (positive; 0 only with no schedule), `recurrenceUnit` (`week` | `month` | `year` | `period` | `none`),
`recurrenceInterval` (≥ 1), `firstDueDate`, `endDate` (nullable), and a due date:
`dueDate` (nullable), `dueUnit` (`week` | `month` | `year`), `dueInterval` (≥ 1).

### Recurrence

Occurrences are `firstDueDate` + k × interval units, for k = 0, 1, 2 …, never after
`endDate`:

- `week`: every `interval` × 7 days. "Saturdays every 2 weeks" = unit week, interval 2,
  first due on a Saturday.
- `month`: add `k × interval` months to `firstDueDate`, clamping the day. "The 25th of
  every month" = unit month, interval 1, first due on a 25th.
- `year`: add `k × interval` years, clamping Feb 29 to Feb 28.
- `none`: no schedule. No occurrence, ever: nothing is generated when a period is created
  or when the item is. The item exists so that transactions can be tied to it as they
  happen (money for the odd job, months apart). It may have no usual amount
  (`defaultAmountCents` 0) and is given no first due date; the column holds the day it was
  added. Every other unit needs both.
- `period`: one occurrence per period, dated on the period's first day, in the period that
  *contains* `firstDueDate` and in every later one (interval ignored). It stops with periods
  that start after `endDate`. Meant for the paycheck: an item first due mid-period still
  shows up in that period, per decision 7.

### Transfers

A transfer stands for another account of the user's own. Money sent to it is money out of
the budget; money brought back is money in. Both are ordinary transactions tied to it with
`billIncomeId`, and nothing about periods, totals or carrying forward treats them specially.

| When | At the bank | In the budget |
| --- | --- | --- |
| Now and then | $400 moves from checking to "Taxes" savings | Money out, tied to the transfer |
| Tax time | $1,500 moves from "Taxes" savings back to checking | Money in, tied to the transfer |
| Same day | A $1,500 check goes to the tax office | Money out, **not** tied to the transfer |

- **Its own direction is money out** (`entryKindOf` in `src/shared/billsIncome.ts`): what a
  scheduled transfer generates, and what choosing it for a new transaction suggests.
  Bringing money back is always entered by hand or imported.
- **Balance** = `openingCents` + paid money out − paid money in, over the transactions tied
  to it. Upcoming ones do not count. Negative is money owed, which is how a loan is held:
  a payment raises it toward zero and a draw lowers it. It is computed on read
  (`totals.balanceCents`; null for a bill or an income) and is never reconciled: interest
  is not in it unless it is entered.
- `openingCents` is what the account held before its first transaction in the budget.
  Setting it moves no money in any period. Only a transfer may have one: any other kind
  with a non-zero value is a field error, on create and after an edit is merged.
- Changing an item's kind, to or from `transfer`, changes nothing that exists. A bill that
  was really a savings account becomes a transfer with its transactions still tied, and
  its balance is there at once.
- A bill or an income also accepts transactions in either direction (a refund tied to a
  bill), and its paid total is their net; it simply has no balance.

### Due dates

When a bill is normally due is separate from when its payment is scheduled: a card due on
the 20th may be paid on payday, or as it happens. `dueDate` is one day it is due; it
repeats every `dueInterval` `dueUnit`s from there, with the same maths as a schedule
(counted from `dueDate`, so the 31st falls back to a short month's last day). Null means
no due date, and then the unit and interval mean nothing. Decided 2026-10-20 (decision 16).

- **Only a bill or a transfer** has one (`canHaveDueDate`: its own entries are money out).
  An income with a due date is a field error on `dueDate`, on create and after an edit is
  merged, so turning a bill into an income must send `dueDate: null` with it.
- Nothing is due before `dueDate` or after the item's `endDate`.
- **Covered.** A due date D, with D′ the day it was due before (one step back from D, even
  when D is the first), is covered by any transaction tied to the item, in its own direction
  (money out), paid or upcoming, whatever the amount, dated after D′ and on or before D.
  It may sit in another period. A refund or money brought back from a transfer pays nothing.
- **Late.** When D is not covered, the first such transaction dated after D and before the
  next due date is reported as late. It still covers that next due date too: a payment is
  not matched to one due date, only looked for in each cycle. (So paying on the 25th for a
  bill due on the 20th warns once, then reads as paying early for the next month.)
- **Notices.** `PeriodView.dueNotices` lists every due date inside the period that is not
  covered, by date and then name, with `lateDate` or null. They are worked out on read
  (`dueNoticesIn`); nothing is stored. The wording is `dueNoticeMessage` in
  `src/shared/dueDates.ts`, past tense once the day has gone by. The home screen shows them
  above the category-limit warnings; the MCP period report has a `DUE:` line for each.
- Setting, changing or removing a due date moves no money and generates nothing.

### Balances (phase 28)

What a bill or transfer's own account owes or holds: a car loan, a card, a savings account.
On screen the page is "Balances"; never "accounts" (decision 11).

- **Tracking** is a row in `tracked_balances` for the item. Only a bill or a transfer can
  have one (`canTrackBalance`); an income is a field error on `billIncomeId`. While tracked,
  an item can't become an income (field error on `kind`). Tracking starts with a check;
  stopping deletes the row and keeps the checks, so tracking again shows them.
- **A check** (`balance_checks`) is a signed balance (below zero is owed), an optional APR
  in basis points (2499 is 24.99%), and `asOf`, a local date-time no later than now (by
  default now). A check that leaves out the APR keeps the last one's. The last check can't
  be deleted while tracked (409).
- **Changing the rate in place.** `PATCH /api/balances/:billIncomeId { aprBps }` sets the
  latest check's APR (null for none) without recording a check: the balance, `asOf` and
  when to ask next stay as they were. Earlier checks keep their rates.
- **The estimate** is worked out on read, never stored: the latest check (by `asOf`, then
  by when it was entered), less the signed amount of every **paid** transaction tied to the
  item dated strictly after `asOf`. Money sent to it (an expense) raises it, money taken
  back lowers it, as a transfer's balance always has. A payment dated on or before the
  check is taken to be in the bank's figure already. Charges and interest on the account's
  own side are not seen until the next check. The interest shown is about a month's at the
  last APR on the estimate (`monthlyInterestCents`); it is not added in.
- A tracked item's `totals.balanceCents` (its transactions endpoint) is this estimate. An
  untracked transfer's is worked out from its starting balance as before.
- **When to ask.** Each tracked item has `next_check_on`. After every check it is set to
  about the interval after today (the item's `check_every_days`, else the user's
  `balance_check_days`, 30 by default; offered as 14, 30, 61 or 91), give or take a quarter
  of it at random (`nextCheckOn`), so items checked together drift apart. Changing the
  interval moves it to match the last check.
- **Today's asks** (`asksFor`): due items (`next_check_on` on or before today), oldest due
  first, then by name, as many as `balance_checks_per_day` (3 by default, 1 to 5) less those
  handled today. Checking or snoozing sets `handled_on` to today, so each uses one of the
  day's asks wherever it was done, and never brings another in its place. Snooze is 1, 3 or
  7 days; "not today" snoozes every one asked about today by a day. The home screen shows
  today's asks on today's period only; the Balances page lists every due one.
- The test app's random is fixed at 0.5: every next check is exactly its interval away.
- **Over time** (`GET /api/balances/over-time`): owed and held across every tracked balance
  at the end of each pay period that exists, from the one holding the earliest check to
  today's, which is as of now. Each balance is read as the estimate is, at that moment: its
  latest check by then, less what was paid tied to it after that check and by then. A
  balance counts from its first check (`counted` says how many did).

### Balances in parts (phase 32)

A student loan made of sub-loans, each with its own balance and APR, under one payment.

- **Parts belong to checks** (`balance_check_parts`). A check has parts or not; each part
  row has the part's own id (`part_id`, the same from check to check), name, position,
  balance and APR. The latest check's parts are the balance's parts now.
- On a check with parts, `balance_checks.balance_cents` is them added up and `apr_bps` their
  rate weighted by balance among those with one (`blendedAprBps`; null when none has one),
  so the estimate and everything else reading a check is unchanged.
- **A check with parts** lists every part (1 to 20): `{ id?, name, balanceCents, aprBps? }`,
  names unique, all owed or all held, no `balanceCents` or `aprBps` beside them. An `id` is
  one of the item's parts from any earlier check; left out, a new part. A part's rate left
  out is its rate from the latest check it was in. A part left out of a check is gone from
  then on. Once the last check has parts, a check without them is a field error on `parts`
  unless it says `parts: []`, which ends the splitting; starting to track is never refused
  this way. "Looks right" records each part at its estimate.
- **The estimate in parts**: the whole is estimated as before; what it has moved since the
  check is shared over the parts in proportion to their balances at the check, in whole
  cents adding up exactly (largest remainder, ties to the earlier part; all at zero:
  evenly) (`shareOverParts`). A payment meant for one part is shared out all the same until
  the next check. Interest a month is each part's at its own rate, added up.
- **Changing a part in place**: `PATCH /api/balances/:billIncomeId/parts/:partId { name?,
  aprBps? }` changes the latest check's part and its blended rate; not a check. The whole's
  `aprBps` patch is a field error on a balance in parts.
- **In Advice** each part is a debt or saving of its own (`partId` set, named "Loan: 1-01"),
  its usual payment the bill's times its share of the balance. Plans key items by
  `planKey` (the part's id, else the bill's). A payment toward a part is still a
  transaction tied to the bill.

### Where extra money goes (phase 29)

The plans in `src/shared/paydown.ts`, worked out by the page as the amount changes and by
the server as facts for a model. Debts are tracked balances below zero (not ended);
savings those at or above.

- **Safe to spare** (`safeToSpare`): paying something now lowers today's period's end and
  every later one by the same amount, so the lowest projected end among today's period
  and the coming ones that exist (as many as the low balance warnings look at, and at
  least five) limits it. The safe amount keeps every one at or above `low_balance_cents`;
  `zeroCents` keeps them at or above zero. A plan never uses more than `zeroCents`. (A
  coming period with a hand-set starting amount doesn't take the carry; that is ignored.)
- **Fastest**: highest APR first, then smaller balances; a debt with no APR last.
  **Fewest payments**: smallest balance first. Each debt takes at most what it owes; what
  no debt needs is left unplaced. **Savings**: all of it to savings, raising the lowest
  to the next, then both, and so on (`splitOverSavings`).
- **Balanced**: savings up to about a month of usual spending (the median past period's
  expenses times periods per month) when they are below it; then debts at 8% APR or more,
  highest first; then half of what is left to savings and half to the highest-rate debt
  still owing; anything the debts don't need goes to savings.
- **Payoff** (`payoffMonths`): month by month, interest at APR / 12 on the balance, then
  the item's usual payment as a monthly amount by its schedule; "never" when the payment
  doesn't cover the interest or it runs past fifty years.
- A Smart answer about extra money ends with `PLAN: [1] $250.00; [3] $100.00`, the numbers
  being the items as the facts list them (debts, then savings). The server keeps it only
  when every number is listed, every amount is positive and they add up to no more than
  the amount the plans use; the line is never shown.

### Turning occurrences into transactions

An occurrence becomes a transaction: `name` = the item's name, amount = default amount with
the sign for its kind (a transfer's is money out), `occursAt` = occurrence date at `00:00`, `status` = `upcoming`,
`billIncomeId` and `occurrenceDate` set. A unique index on `(billIncomeId, occurrenceDate)`
(one-off transactions have a null `billIncomeId`, which a unique index ignores)
makes this idempotent; insert with "do nothing on conflict".

It happens at exactly two moments:

1. **When a period is generated**: every occurrence of every bill or income that falls
   inside the new period.
2. **When a bill or income is created**: every occurrence that falls inside any period
   that already exists, starting with the period that contains `firstDueDate`. Usually
   that is just the current period. Apply leftover deltas, in ascending `seq`.

   A first due date in the past therefore back-fills earlier periods. That is allowed, and
   has consequences the UI must spell out before saving (see phase 5):
   - each back-filled transaction arrives as `upcoming` in a period that is already over,
     so it shows as unpaid until the user marks it;
   - the projected leftover of those periods changes, and the difference flows into every
     later starting amount through `applyLeftoverDelta`, stopping at a manual one as usual;
   - occurrences dated before the first period are skipped: no period holds them.

It is a one-time calculation. Afterwards the transaction is independent:

- Editing a bill or income (amount, schedule, name, first due date) changes nothing that
  already exists; it affects periods generated later.
- Moving a period boundary neither creates nor removes occurrences.
- Editing or deleting a generated transaction does not touch the bill or income.

### Archiving

A bill or income is **archived** when `endDate` is before today. Archived items are hidden
from the Recurring page unless "show archived" is on, and produce no further occurrences.
"End this" sets `endDate` to today and offers to delete the upcoming transactions it
generated that are dated after today. Transactions tied to it by hand are left alone.

Deleting a bill or income keeps its past transactions (their `billIncomeId` becomes null).

## Tables (target shape)

Phases add these with migrations; column names follow the existing snake_case style.

```
user_settings      user_id PK → users, timezone, advice_persona, advice_persona_custom,
                   low_balance_cents (20000), low_balance_periods (5),
                   balance_check_days (30), balance_checks_per_day (3), created_at, updated_at
budget_schedules   id, user_id → users (unique for now), type, anchor_date,
                   opening_cents, created_at
periods            id, user_id → users, schedule_id → budget_schedules, seq,
                   start_date, end_date, nominal_start, nominal_end,
                   starting_cents, starting_mode, carry_stale, created_at, updated_at
                   unique (user_id, seq); unique (user_id, start_date)
transactions       id, user_id → users, name, amount_cents, occurs_at, status, paid_at,
                   sort_order, note, bill_income_id → bills_income (set null),
                   occurrence_date, import_key, category_id → categories (set null),
                   created_at, updated_at
                   index (user_id, occurs_at); index (category_id)
                   unique (bill_income_id, occurrence_date)   -- nulls don't collide
                   unique (user_id, import_key)             -- likewise
bills_income       id, user_id → users, name, description, kind, opening_cents, default_amount_cents,
                   recurrence_unit, recurrence_interval, first_due_date, end_date,
                   category_id → categories (set null),
                   due_date (null = none), due_unit, due_interval,
                   created_at, updated_at
categories         id, user_id → users, name, default_limit_cents (null = none),
                   created_at, updated_at
                   unique (user_id, lower(name))
period_category_limits   period_id → periods, category_id → categories, user_id → users,
                   limit_cents, created_at, updated_at
                   primary key (period_id, category_id); all three cascade
api_tokens         id, user_id → users, name, token_hash, hint, scope, created_at,
                   last_used_at, expires_at (null = never)
                   unique (token_hash)
deleted_import_keys  user_id → users, import_key, deleted_at
                   primary key (user_id, import_key)
tracked_balances   bill_income_id PK → bills_income, user_id → users, check_every_days (null = the user's),
                   next_check_on, handled_on, created_at, updated_at
balance_checks     id, user_id → users, bill_income_id → bills_income, balance_cents, apr_bps (null = none),
                   as_of, created_at
                   index (bill_income_id, as_of)
```

All child rows cascade when a user is deleted.

## API surface

Everything except sign-in, registration, `/api/auth/config` and `/api/health` requires a
session: either the cookie the web app gets, or `Authorization: Bearer <token>` for a
client that signed in with `transport: "token"`. Errors use the envelope in
`src/shared/api.ts`.

**Idle timeout.** A browser's session (the cookie) also ends when no request arrives for
`IDLE_TIMEOUT_MINUTES` (10; 0 turns it off). The browser signs itself out on time; the
server waits two minutes longer, so it is the backstop for a closed tab or a copied cookie
and never ends a session that is in use. A `transport: "token"` session (the Android app)
has no idle timeout on the server: the app locks itself instead. `GET /api/auth/config`
tells a client the number of minutes.

An **API token** (created in Settings, sent the same way as a bearer) also works, for
budget data only: every endpoint below outside `/api/auth`, plus `GET /api/auth/me`. On
the rest of `/api/auth` it gets a 403. A `read` token may only send `GET`; a `write` token
may send anything. Changing the password revokes them all.

**API tokens can be turned off for the whole server** with `ALLOW_API_TOKENS=false` (on by
default). Then anything sent as an API token, valid or not, gets a 403 that says "API
tokens are turned off on this server", on every endpoint; and `POST /api/auth/tokens`
gets the same from a signed-in session. Tokens are kept: listing and revoking still work,
and they are usable again when it is turned back on. Sessions are untouched. This is how
assistant (MCP) access is switched off, since an API token is all the MCP server has.
`GET /api/auth/config` reports it as `apiTokensEnabled`.

```
GET    /api/health                     200 when the server and database are up
GET    /api/auth/config                → { registrationOpen, idleTimeoutMinutes, apiTokensEnabled }
POST   /api/auth/register              body may include transport: "cookie" | "token"
POST   /api/auth/login                 likewise; "token" returns { user, token, expiresAt }
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/password              { currentPassword, newPassword }
GET    /api/auth/sessions              signed-in devices
DELETE /api/auth/sessions/:id
POST   /api/auth/sessions/revoke-others
GET    /api/auth/tokens                API tokens, without their secrets → { tokens }
POST   /api/auth/tokens                { name, scope: "read" | "write", expiresInDays? } → { secret, token }; the secret is never shown again
DELETE /api/auth/tokens/:id
PATCH  /api/settings                   { timezone }
PUT    /api/settings/low-balance       { lowBalanceCents (≥ 0), periodsAhead (0 to 10) } → { settings }
GET    /api/budget                     → { budget | null }
POST   /api/budget                     setup; 409 if one exists
GET    /api/periods                    every existing period, oldest first → { periods }
GET    /api/periods/current            ensures a period for today → PeriodView
GET    /api/periods/outlook            the existing periods after the current one → { settings, periods: [{ periodId, startDate, endDate, projectedCents, level: "ok" | "low" | "negative" }] }; creates nothing
POST   /api/periods/earlier            adds the period before the earliest → { periodId }
GET    /api/periods/:id                → PeriodView
POST   /api/periods/locate   { date }  ensures through date → { periodId }
PATCH  /api/periods/:id/dates          { startDate?, endDate?, preview? }
POST   /api/periods/:id/dates/revert
PATCH  /api/periods/:id/starting       { startingCents, carryForward }
POST   /api/periods/:id/starting/revert
POST   /api/periods/:id/recalculate
PUT    /api/periods/:id/limits/:categoryId   { limitCents } → PeriodView
DELETE /api/periods/:id/limits/:categoryId   → PeriodView; 404 if the period has none for it
GET    /api/transactions?from=&to=     dated within the range, both ends included, at most 366 days → { transactions }; creates nothing
GET    /api/transactions/search?q=&from=&to=&categoryId=&limit=&before=
                                       any period, newest first → { transactions, nextCursor, totals: { count, outCents, inCents } }.
                                       q is part of the name or note, whatever its capitals, spaces and punctuation; categoryId "none" is filed under nothing;
                                       at least one of q, from, to, categoryId. Creates nothing
POST   /api/transactions               may carry billIncomeId and countsToward (see "Linking to a bill or income"), and categoryId
PATCH  /api/transactions/:id           may carry billIncomeId; null unties. And categoryId; null unfiles
DELETE /api/transactions/:id
PUT    /api/transactions/order         { ids }
POST   /api/transactions/import        { transactions (1 to 500), dryRun?, addEarlierPeriods?, restoreDeleted? } → what was (or would be) saved; all or nothing
POST   /api/transactions/split         { name, kind, occursAt, note?, billIncomeId?, categoryId?, finishEarly?, roundUp?, items (1 to 10: label, amountCents, dueDate), dryRun? } → { payments, later, waitingId, splitId, current }; one transaction per period up to the furthest one, the rest kept as waiting payments; all or nothing (phase 27)
GET    /api/balances                   { balances (by name), totals: { owedCents, heldCents }, asks, settings }
PUT    /api/balances/settings          { checkEveryDays (14|30|61|91), checksPerDay (1 to 5) } → { settings }
POST   /api/balances/snooze-today      every item asked about today waits a day → 204
GET    /api/balances/:billIncomeId     { balance, checks (newest first), since (paid since the last, oldest first) }
POST   /api/balances/:billIncomeId     starts tracking { balanceCents, aprBps?, asOf?, checkEveryDays? } → 201 { balance }
PATCH  /api/balances/:billIncomeId     { checkEveryDays | null } → { balance }
DELETE /api/balances/:billIncomeId     stops tracking; the checks stay → 204
POST   /api/balances/:billIncomeId/checks       { balanceCents, aprBps? (left out: the last), asOf? } → 201 { balance }
DELETE /api/balances/:billIncomeId/checks/:id   → { balance }; 409 for its only check
POST   /api/balances/:billIncomeId/looks-right  records the estimate as a check → 201 { balance }
POST   /api/balances/:billIncomeId/snooze       { days: 1 | 3 | 7 } → { balance }
GET    /api/advice/quick               { answers (the four Quick Questions), extra }: no model needed. `extra` is what the
                                       extra money plans are worked out from: today's and the coming periods' projected ends,
                                       lowBalanceCents, debts and savings (tracked balances), monthlySpendCents, categoryIds
GET    /api/advice                     { groups, persona }: the Smart Questions; 403 without a model
POST   /api/advice                     { questionId, amountCents? (needed for an "Extra money" one) } →
                                       { questionId, answer, askedAt, plan? }; plan is null when the answer's PLAN line failed the checks
PUT    /api/advice/persona             { persona, custom? } → { persona }
GET    /api/splits                     { splits }: every split with anything unpaid: its waiting payments (inReach, remind), items (leftCents), upcoming transactions, paidCents (phase 31)
POST   /api/splits/:id/items           { occursAt, items (label needed), roundUp?, dryRun? } → { payments, later, labels }; works its unpaid payments out again from occursAt's period (phase 31)
POST   /api/splits/:id/skip            { transactionId, dryRun? } → { payments, later, labels, skipped }; 409 for the last payment before an item is due, or a paid one (phase 31)
POST   /api/splits/:id/add             adds its waiting payments that are in reach → { added, waiting? }; 409 if none are
DELETE /api/splits/:id                 drops what it still has waiting
GET    /api/bills-income
POST   /api/bills-income                  may carry categoryId, and dueDate, dueUnit, dueInterval
POST   /api/bills-income/preview          what creating this item would add, without saving
GET    /api/bills-income/:id/transactions ?limit= (30, at most 100) &before=<nextCursor> → { transactions (newest first), nextCursor, totals }
                                           totals: { count, paidCents, upcomingCents (signed nets), paidOutCents, paidInCents (positive), balanceCents (a transfer's; else null) }
PATCH  /api/bills-income/:id              may carry categoryId and applyToTransactions → { item, refiledTransactions? }
DELETE /api/bills-income/:id
POST   /api/bills-income/:id/end
GET    /api/categories                 → { categories }, by name
POST   /api/categories                 { name, defaultLimitCents?, applyToPeriods? }
PATCH  /api/categories/:id             { name?, defaultLimitCents? (null removes it), applyToPeriods? }
DELETE /api/categories/:id             its transactions stay, filed under nothing
GET    /api/reports?from=&to=          → Report (src/shared/reports.ts): the pay periods sharing a day with the span, whole,
                                       paid and upcoming together. Creates nothing
```

`PeriodView`:

```ts
{
  period: {
    id, seq, startDate, endDate, nominalStart, nominalEnd,
    datesEdited: boolean, isCurrent: boolean,
    startingCents, startingMode: "auto" | "manual", carryStale: boolean,
  },
  totals: { paidCents, upcomingCents, leftoverCents, projectedCents },
  transactions: Transaction[],          // ordered; empty until phase 4
  categoryLimits: Array<{ categoryId, name, limitCents, spentCents, paidSpentCents }>,   // by name
  dueNotices: Array<{ billIncomeId, name, dueDate, lateDate }>,   // uncovered due dates in it, by date
  nav: { prevId: string | null, canAddPrevious: boolean, nextId: string | null, nextDate: LocalDate | null, lastId: string | null },
}
```

`nav.canAddPrevious` is true when there is no previous period but one may be added
(`POST /api/periods/earlier`).

`nav.nextId` is set when the next period already exists. Otherwise `nav.nextDate` is the
day after this period ends if that is within the horizon (the client calls `locate` with
it), or null when the horizon has been reached.

`nav.lastId` is the latest period that exists (the one with the highest `seq`), for the
"Latest" link. It is null when that is this period, or when it is today's period, which the
"Today" link already reaches.
