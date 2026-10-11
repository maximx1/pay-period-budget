# Phase 6: Period adjustments

**Goal:** handle real-life exceptions: a payday that lands a day early or late, and a
starting amount that needs correcting by hand, with control over whether the correction
carries forward.

**Depends on:** phase 5. **Suggested model:** Opus, or Sonnet with an Opus review of 6.1 and
6.2. The edge cases here are where a budget silently goes wrong.

Decision 1 in `README.md` is settled: periods stay contiguous and a neighbour's shared
boundary always follows. There are no opt-out checkboxes.

**Read first:** `domain.md` sections "Carrying leftover forward", "Manual starting amount"
and "Editing period dates".

**No new dependencies.**

## Tasks

### 6.1 Starting amount: service and endpoints

- [ ] Done

**Files:** `src/shared/budget.ts`, `src/server/services/carry.ts`,
`src/server/services/periods.ts`, `src/server/routes/periods.ts`,
new `src/server/routes/periods.starting.test.ts`.

- `carry.ts` gains `recomputeChain(repos, userId, fromSeq)` per `domain.md`, and
  `markStaleAfter(repos, userId, afterSeq)` (sets `carryStale` on each following period
  until a `manual` one).
- `PATCH /api/periods/:id/starting` with `{ startingCents: integer, carryForward: boolean }`:
  set the value and `startingMode = manual`; then either apply the delta after this period
  or mark the following run stale.
- `POST /api/periods/:id/starting/revert`: `startingMode = auto`, then `recomputeChain`
  from this period. For `seq` 0 the calculated value is the schedule's `openingCents`.
- `POST /api/periods/:id/recalculate`: find the first period of the stale run that
  contains this one (walk back while the previous period is stale and `auto`), then
  `recomputeChain` from there. 409 if this period isn't stale.
- All three return the updated `PeriodView`.

**Tests** (build a chain of six periods with a few transactions each; call the periods
P0..P5):
- Manual on P2 with carry forward: P3..P5 shift by the difference; none are stale.
- Manual on P2 without carry forward: P3..P5 keep their values and are stale; P2 is not.
- Then add a transaction in P1: P2 is unchanged (pinned); P3..P5 unchanged (the delta
  stopped at P2).
- Then add a transaction in P3: P4 and P5 shift by it and remain stale.
- Then recalculate on P4: P3..P5 equal the true chained values from P2's manual amount and
  are no longer stale.
- Two manual periods (P1 and P4), edit P1 with carry forward: P2 and P3 shift, P4 and P5
  don't. Edit P1 without: only P2 and P3 go stale.
- Revert P4: it takes P3's leftover, P5 follows, P4 is `auto` again.
- Revert P0 returns to the opening balance.
- Generating a new period after a stale tail makes it stale too; after a clean tail, not.
- Recalculate on a non-stale period → 409. Cross-user → 404.

### 6.2 Period dates: service and endpoints

- [ ] Done

**Files:** `src/shared/budget.ts`, `src/server/services/periods.ts`,
`src/server/routes/periods.ts`, new `src/server/routes/periods.dates.test.ts`.

- `PATCH /api/periods/:id/dates` with `{ startDate?: LocalDate, endDate?: LocalDate,
  preview?: boolean }`. In one transaction:
  1. Work out the new boundaries for this period and the shared boundary of each affected
     neighbour (previous period's `endDate` = new start − 1; next period's `startDate` =
     new end + 1).
  2. Validate: this period and each affected neighbour stay at least one day long; if the
     period is the last generated one, moving its end is allowed as long as it stays
     before the *next* period's nominal end (so the period generated after it is still at
     least one day long). Violations are field errors on `startDate` /
     `endDate` with a message naming the limit ("Can't be earlier than Dec 12, the day
     after the previous period starts").
  3. Find every transaction whose date sits in a day that changed owner and apply the
     leftover deltas as for a date move.
  4. Respond with `{ view: PeriodView, changes: Array<{ periodId, startDate, endDate,
     previousStartDate, previousEndDate }>, movedTransactions: number }`.
  With `preview: true`, do steps 1–2 and compute step 3's count, but write nothing.
- `POST /api/periods/:id/dates/revert`: the same operation with the nominal dates.
- `nominalStart` / `nominalEnd` are never written after creation.

**Tests:**
- Move P2's start one day earlier: P1's end moves one day earlier; a transaction dated on
  that day now appears in P2; leftover invariant holds for the whole chain.
- Move P2's end one day later: P3's start follows; P3's end and P4 are untouched.
- Generate a new period after editing the last period's end: it starts the day after the
  edited end and finishes on its nominal end.
- Shrinking a neighbour to zero days → 400. Start after end → 400.
- `preview: true` returns the same `changes` and writes nothing.
- Revert restores nominal dates on the period and both neighbours' shared boundaries.
- Recurring occurrences are neither duplicated nor dropped by any of the above.
- Editing dates on a chain that contains a manual and a stale period keeps their flags.

### 6.3 Period settings dialog

- [ ] Done

**Files:** new `src/client/features/periods/PeriodSettingsDialog.tsx`,
`src/client/features/periods/api.ts`, `PeriodHeader.tsx`, `PeriodSummary.tsx`.

- A gear `IconButton` ("Period settings") in `PeriodHeader` opens the dialog. When the
  period's dates are edited, the header shows a small "edited" badge next to the range.
- **Dates section:** start and end date inputs. As they change, call the endpoint with
  `preview: true` (debounced) and show the result in plain words under the inputs:
  "The previous period will end Dec 23 instead of Dec 24." / "The next period will start
  Dec 26 instead of Dec 25." / "2 transactions will move to a different period."
  Field errors appear under the relevant input. "Reset to schedule" appears when the dates
  differ from nominal.
- **Starting amount section:** money input pre-filled with the current value; a "Carry
  this change into later periods" checkbox, checked by default, with helper text that
  changes with its state (unchecked: "Later periods keep their current starting amounts
  and will be marked as possibly out of date."). When the amount is manual, show "Set by
  hand" and a "Use calculated amount" button (revert).
- Save applies whichever sections changed, then invalidates every `["period", ...]` query.

In `PeriodSummary`, next to Starting:
- manual → a pencil-with-dot icon, tooltip "Set by hand", plus a small revert `IconButton`
  ("Use calculated amount").
- stale → a warning icon in `text-warning`, tooltip "An earlier period's starting amount
  was changed without carrying it forward, so this may be out of date.", plus a
  "Recalculate" text button.

**Accept when:** the Christmas case works end to end: move a period's end one day earlier,
confirm the preview text is right, save, and see the next period start a day earlier with
its transactions intact; and the manual / stale / recalculate cycle from 6.1's tests can be
driven from the UI.

## Implementation notes

(Add notes here as tasks are completed.)
