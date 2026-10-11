# Domain rules

The single source of truth for how periods, transactions and recurring items behave. Phase files
say what to build; this file says what must always be true.

## Vocabulary

- **Budget schedule**: how a user's periods repeat (weekly, biweekly or monthly) from an
  anchor date.
- **Period**: one span of the budget, from payday through the day before the next payday.
  The home screen shows one period at a time.
- **Transaction**: one payment or one deposit, dated, either *upcoming* or *paid*.
- **Recurring item**: a recurring bill or recurring income. It is a template that produces
  transactions; it holds no balance. Income is not special: it is a recurring item whose
  amount is positive. (The word **account** is reserved for a future feature: the places
  money lives or goes, such as a savings account or a person you pay. See `backlog.md`.)
- **Starting amount**: what a period begins with. Normally the previous period's projected
  leftover.
- **Projected leftover**: starting amount + every transaction in the period, paid or not.
  This is what carries into the next period.
- **Leftover so far**: starting amount + paid transactions only. If the bank statement
  disagrees with this, something was missed.

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

A schedule defines **nominal periods** by index (`seq`, starting at 0):

- `weekly`: nominal start = anchor + 7 × seq days
- `biweekly`: nominal start = anchor + 14 × seq days
- `monthly`: nominal start = anchor + seq months, clamping the day to the month's length.
  Always add months to the *anchor*, never to the previous start, so an anchor on the 31st
  gives Jan 31, Feb 28, Mar 31 rather than drifting to the 28th.
- nominal end = the next nominal start − 1 day

Setup rules: the anchor date must be today or earlier, and no more than 366 days back.

## Periods

Invariants (must hold after every write):

1. A user's periods are numbered `seq` 0, 1, 2 … with no holes.
2. They are **contiguous**: `period[n+1].startDate = period[n].endDate + 1 day`.
3. Every period is at least one day long.
4. There is always a period containing today (created on demand).

### Generation

Periods are created lazily and only at the tail. `ensureThrough(userId, date)`:

- Rejects a date before the first period's start.
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
  - then materialise recurring occurrences for the new period (see Recurring items)

Generation is always validated and performed on the server. The client only asks for a
period by id, for "current", or for "the period containing date X".

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
together, as "`leftoverCents` of `projectedCents` projected".

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

## Transactions

Fields: `id`, `userId`, `name`, `amountCents` (signed), `occursAt`, `status`
(`upcoming` | `paid`), `paidAt`, `sortOrder`, `note`, and for generated ones `recurringId`
and `occurrenceDate`.

- The API accepts a positive amount plus `kind` (`expense` | `income`) and stores the
  signed value. Zero is rejected.
- One-off transactions default to `upcoming` unless created with `paid: true`.
- Marking paid sets `paidAt`; marking upcoming clears it.
- Display order within a section: `occursAt`, then `sortOrder`, then `createdAt`.
  `sortOrder` only matters between transactions with identical `occursAt` (phase 7 adds
  manual reordering; until then it is 0).
- Deleting is a hard delete.

## Recurring items

Fields: `id`, `userId`, `name`, `description`, `kind` (`expense` | `income`),
`defaultAmountCents` (positive), `recurrenceUnit` (`week` | `month` | `year` | `period`),
`recurrenceInterval` (≥ 1), `firstDueDate`, `endDate` (nullable).

### Recurrence

Occurrences are `firstDueDate` + k × interval units, for k = 0, 1, 2 …, never after
`endDate`:

- `week`: every `interval` × 7 days. "Saturdays every 2 weeks" = unit week, interval 2,
  first due on a Saturday.
- `month`: add `k × interval` months to `firstDueDate`, clamping the day. "The 25th of
  every month" = unit month, interval 1, first due on a 25th.
- `year`: add `k × interval` years, clamping Feb 29 to Feb 28.
- `period`: one occurrence per period, dated on the period's first day, in the period that
  *contains* `firstDueDate` and in every later one (interval ignored). It stops with periods
  that start after `endDate`. Meant for the paycheck: an item first due mid-period still
  shows up in that period, per decision 7.

### Turning occurrences into transactions

An occurrence becomes a transaction: `name` = the item's name, amount = default amount with
the sign for its kind, `occursAt` = occurrence date at `00:00`, `status` = `upcoming`,
`recurringId` and `occurrenceDate` set. A unique index on `(recurringId, occurrenceDate)`
(one-off transactions have a null `recurringId`, which a unique index ignores)
makes this idempotent; insert with "do nothing on conflict".

It happens at exactly two moments:

1. **When a period is generated**: every occurrence of every recurring item that falls
   inside the new period.
2. **When a recurring item is created**: every occurrence that falls inside any period
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

- Editing a recurring item (amount, schedule, name, first due date) changes nothing that
  already exists; it affects periods generated later.
- Moving a period boundary neither creates nor removes occurrences.
- Editing or deleting a generated transaction does not touch the recurring item.

### Archiving

A recurring item is **archived** when `endDate` is before today. Archived items are hidden
from the Recurring page unless "show archived" is on, and produce no further occurrences.
"End this" sets `endDate` to today and offers to delete its upcoming transactions dated
after today.

Deleting a recurring item keeps its past transactions (their `recurringId` becomes null).

## Tables (target shape)

Phases add these with migrations; column names follow the existing snake_case style.

```
user_settings      user_id PK → users, timezone, created_at, updated_at
budget_schedules   id, user_id → users (unique for now), type, anchor_date,
                   opening_cents, created_at
periods            id, user_id → users, schedule_id → budget_schedules, seq,
                   start_date, end_date, nominal_start, nominal_end,
                   starting_cents, starting_mode, carry_stale, created_at, updated_at
                   unique (user_id, seq); unique (user_id, start_date)
transactions       id, user_id → users, name, amount_cents, occurs_at, status, paid_at,
                   sort_order, note, recurring_id → recurring_items (set null),
                   occurrence_date, created_at, updated_at
                   index (user_id, occurs_at)
                   unique (recurring_id, occurrence_date)   -- nulls don't collide
recurring_items    id, user_id → users, name, description, kind, default_amount_cents,
                   recurrence_unit, recurrence_interval, first_due_date, end_date,
                   created_at, updated_at
```

All child rows cascade when a user is deleted.

## API surface

Everything except sign-in, registration, `/api/auth/config` and `/api/health` requires a
session: either the cookie the web app gets, or `Authorization: Bearer <token>` for a
client that signed in with `transport: "token"`. Errors use the envelope in
`src/shared/api.ts`.

```
GET    /api/health                     200 when the server and database are up
GET    /api/auth/config                → { registrationOpen }
POST   /api/auth/register              body may include transport: "cookie" | "token"
POST   /api/auth/login                 likewise; "token" returns { user, token, expiresAt }
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/password              { currentPassword, newPassword }
GET    /api/auth/sessions              signed-in devices
DELETE /api/auth/sessions/:id
POST   /api/auth/sessions/revoke-others
PATCH  /api/settings                   { timezone }
GET    /api/budget                     → { budget | null }
POST   /api/budget                     setup; 409 if one exists
GET    /api/periods/current            ensures a period for today → PeriodView
GET    /api/periods/:id                → PeriodView
POST   /api/periods/locate   { date }  ensures through date → { periodId }
PATCH  /api/periods/:id/dates          { startDate?, endDate?, preview? }
POST   /api/periods/:id/dates/revert
PATCH  /api/periods/:id/starting       { startingCents, carryForward }
POST   /api/periods/:id/starting/revert
POST   /api/periods/:id/recalculate
POST   /api/transactions
PATCH  /api/transactions/:id
DELETE /api/transactions/:id
PUT    /api/transactions/order         { ids }
GET    /api/recurring
POST   /api/recurring
POST   /api/recurring/preview          what creating this item would add, without saving
PATCH  /api/recurring/:id
DELETE /api/recurring/:id
POST   /api/recurring/:id/end
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
  nav: { prevId: string | null, nextId: string | null, nextDate: LocalDate | null },
}
```

`nav.nextId` is set when the next period already exists. Otherwise `nav.nextDate` is the
day after this period ends if that is within the horizon (the client calls `locate` with
it), or null when the horizon has been reached.
