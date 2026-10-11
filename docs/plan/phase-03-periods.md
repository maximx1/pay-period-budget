# Phase 3: Budget setup and the period engine

**Goal:** a new user picks their pay schedule and start date, and from then on the home
screen always shows the period containing today, with navigation backwards and forwards
(forwards up to the one-year horizon). Periods have starting and leftover amounts, though
with no transactions yet they simply carry the opening balance along.

**Depends on:** phase 2. **Suggested model:** Sonnet; have Opus review 3.3 before moving on,
because every later phase builds on it.

**Read first:** `domain.md` sections "Budget schedule", "Periods" and "Tables".

**No new dependencies.**

## Tasks

### 3.1 Schedule math (pure)

- [ ] Done

**Files:** new `src/shared/schedule.ts`, `src/shared/schedule.test.ts`.

```ts
export const SCHEDULE_TYPES = ["biweekly", "weekly", "monthly"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export type Schedule = { type: ScheduleType; anchorDate: LocalDate };

nominalStart(schedule, seq): LocalDate
nominalPeriod(schedule, seq): { start: LocalDate; end: LocalDate }
seqForDate(schedule, date): number          // throws RangeError if date < anchorDate
horizonSeq(schedule, today): number         // seqForDate(schedule, today + 1 year)
```

Follow the formulas in `domain.md` exactly. `seqForDate` for monthly must not assume a
fixed month length: estimate from the month difference, then step until
`nominalStart(seq) <= date < nominalStart(seq + 1)`.

**Tests:** for each type, `nominalPeriod` for seq 0, 1, 2 and a large seq; consecutive
nominal periods are contiguous for seq 0 to 60 (loop); monthly anchored on the 29th, 30th
and 31st across February in leap and non-leap years; `seqForDate` on the first and last
day of a period and round-tripped against `nominalPeriod` for every day in a two-year
span; `horizonSeq` for each type.

### 3.2 Tables and repositories

- [ ] Done

**Files:** `src/server/db/schema.ts`, new migration via `npm run db:generate -- --name budget_periods`,
`src/server/repos/types.ts`, new `src/server/repos/sqlite/settings.ts`, `schedules.ts`,
`periods.ts`, `src/server/repos/sqlite/index.ts`, new `src/server/repos/sqlite/periods.test.ts`.

Add `user_settings`, `budget_schedules` and `periods` exactly as listed under "Tables" in
`domain.md`. `starting_mode` is text (`auto` | `manual`), `carry_stale` an integer boolean
defaulting to false.

Repository interfaces (all scoped by `userId`):

```ts
SettingsRepo   get(userId), upsert(userId, { timezone }, now)
ScheduleRepo   getForUser(userId), create(schedule)
PeriodRepo     findById(userId, id)
               findBySeq(userId, seq)
               findContaining(userId, date)     // start_date <= date <= end_date
               findLast(userId)                 // highest seq
               listFromSeq(userId, fromSeq)     // ascending; used by the carry-forward walk
               create(period)
               update(userId, id, patch, now)   // patch: dates, startingCents, startingMode, carryStale
```

**Tests:** `findContaining` on both boundary days and in a gap-free pair of periods;
unique violation on duplicate `(user_id, seq)` surfaces as `UniqueConstraintError`;
a second user cannot read the first user's period by id.

### 3.3 Period service and endpoints

- [ ] Done

**Files:** new `src/shared/budget.ts` (zod schemas + response types), new
`src/server/services/periods.ts`, `src/server/routes/budget.ts`,
`src/server/routes/periods.ts`, `src/server/app.ts`, new `src/server/routes/periods.test.ts`.

Shared schemas:
- `budgetSetupSchema`: `{ type: ScheduleType, anchorDate: LocalDate, openingCents: integer
  (may be negative, default 0), timezone: string }`. Validate the time zone by trying
  `new Intl.DateTimeFormat("en", { timeZone })` in a refinement.
- `locateSchema`: `{ date: LocalDate }`.
- Types `Budget`, `PeriodView` as in `domain.md`.

Service (`createPeriodService({ store, now })`):
- `getBudget(userId)`.
- `setup(userId, input)`: 409 `conflict` if a schedule exists. Validate the anchor against
  "today" in the submitted time zone (not in the future; at most 366 days back; field
  errors keyed `anchorDate`). In one transaction: upsert settings, create the schedule,
  create period seq 0 (`startingCents = openingCents`), then `ensureThrough(today)`.
- `ensureThrough(userId, date)`: implement "Generation" from `domain.md`. Out-of-range
  dates throw a 400 `validation` error with `fields.date`. Leave a clearly marked call site
  (a no-op function parameter or hook) where phase 5 will materialise recurring occurrences
  for each newly created period.
- `getCurrent(userId)`: today from the user's stored time zone → `ensureThrough` → view.
- `getView(userId, periodId)`: 404 if not this user's. Build `PeriodView`; until phase 4
  `transactions` is `[]` and the paid/upcoming totals are 0.
- `locate(userId, date)`: `ensureThrough` then return the containing period's id.
- A user with no schedule calling a period endpoint gets 409 `conflict` with the message
  "Set up your budget first".

The projected leftover used for "previous period's leftover" comes from one private
function `projectedOf(period)` so phase 4 has a single place to add the transaction sum.

Routes, all behind `requireAuth`: `GET /api/budget`, `POST /api/budget`,
`GET /api/periods/current`, `GET /api/periods/:id`, `POST /api/periods/locate`.

**Tests** (drive the clock with `t.clock`; note it starts at 2026-01-15T12:00Z):
- Setup with a biweekly anchor 30 days back creates three periods and "current" is the
  third; each starts the day after the previous ends.
- Opening balance flows into every generated period's `startingCents`.
- Setup twice → 409. Anchor tomorrow → 400 on `anchorDate`. Anchor 400 days back → 400.
- `locate` for a date 11 months ahead generates through it; 14 months ahead → 400; a date
  before the anchor → 400.
- Advancing the clock by 20 days and calling `current` again creates the next period, and
  `nav.prevId` links back.
- `nav`: first period has `prevId` null; last generated has `nextId` null and a `nextDate`;
  at the horizon `nextDate` is null.
- Concurrent `current` calls (`Promise.all` of five) leave no duplicate periods.
- A second user gets 404 for the first user's period id.
- Monthly schedule anchored on the 31st produces Jan 31, Feb 28, Mar 31 starts.

### 3.4 Setup screen

- [ ] Done

**Files:** new `src/client/features/budget/api.ts` (query + mutation hooks),
`SetupPage.tsx`, `RequireBudget.tsx`; `src/client/router.tsx`.

- `useBudget()` queries `GET /api/budget` under the key `["budget"]`.
- `RequireBudget` sits inside `RequireAuth` and wraps the `AppShell` routes: while loading
  show `FullPageSpinner`; if there is no budget, redirect to `/setup`; otherwise render.
  `/setup` itself is inside `RequireAuth` but outside the shell, and redirects to `/` if a
  budget already exists.
- `SetupPage`: a single centred card, same visual language as the sign-in page.
  - "How often are you paid?" as three large radio cards: Every 2 weeks (default), Every
    week, Monthly.
  - "When did your current pay period start?" with `<input type="date">`, default today,
    `max` today. Helper text: "Usually your most recent payday."
  - "Starting balance" money input (optional, default 0), using `parseMoneyInput`. Helper
    text: "What you have to work with at the start of this period."
  - Time zone is taken from `Intl.DateTimeFormat().resolvedOptions().timeZone` and shown as
    a line of muted text ("Time zone: America/Chicago"); no picker yet.
  - Submit → `POST /api/budget`; on success set the `["budget"]` cache and go to `/`.
    Map field errors with `applyApiError`.

**Accept when:** a brand-new account is sent to `/setup`, cannot reach `/` until it is
complete, and afterwards never sees `/setup` again (typing the URL redirects home).

### 3.5 Home view: the period frame

- [ ] Done

**Files:** new `src/client/features/periods/api.ts`, `PeriodHeader.tsx`,
`PeriodSummary.tsx`; `src/client/features/home/HomePage.tsx`; `src/client/router.tsx`.

- Routes: `/` shows the current period; `/periods/:periodId` shows that period. Both render
  `HomePage`, which picks `usePeriod(periodId)` or `useCurrentPeriod()`.
  Query keys: `["period", "current"]` and `["period", id]`. When "current" resolves, also
  seed `["period", id]`.
- `PeriodHeader`: previous and next `IconButton`s around the date range
  (`formatDateRange`). Previous is disabled when `nav.prevId` is null. Next navigates to
  `nav.nextId`, or calls `locate` with `nav.nextDate` and then navigates, or is disabled
  when both are null (tooltip: "That's as far ahead as the budget goes"). A "Today" button
  appears when `isCurrent` is false and links to `/`.
- `PeriodSummary`: a leftover block and three smaller figures, formatted with
  `formatCents`.
  - Leftover is the dominant element and shows both figures from `domain.md` together:
    the leftover so far in large type, then "of $180.55 projected" beside or beneath it in
    muted type. Either figure uses `text-danger` when negative. When nothing is upcoming
    the two are equal; still show both so the layout doesn't jump.
  - Starting, Paid and Upcoming sit in a row of three (stacking under the leftover block on
    phones, beside it from `lg`).
- Below the summary leave an `EmptyState` ("No transactions yet") that phase 4 replaces.
- Loading: skeleton blocks, not a spinner, so the layout doesn't jump. Error: an `Alert`
  with a retry button.

**Accept when:** stepping forward repeatedly walks period by period to the horizon and
stops; stepping back reaches the first period and stops; "Today" returns to the current
period; reloading on `/periods/<id>` shows the same period.

## Implementation notes

(Add notes here as tasks are completed.)
