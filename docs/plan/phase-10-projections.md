# Phase 10: Projections

**Goal:** a new tab that answers "how much will I have at the start of the period
beginning 12/23/26?", for any future period, including ones that do not exist yet.

**Depends on:** phase 5 (recurring items). **Suggested model:** Opus for 10.1 (it restates
the period and recurrence rules without writing anything), Sonnet for the rest.

**Status:** planned 2026-10-11 at the owner's request. Not started.

## What a projection is

The starting amount a period *would* have if nothing changes from here:

- For a period that already exists, it is the stored `startingCents`. Its end is the
  projected leftover the home view already shows.
- For a period that has not been generated, it is worked out the way generation would do
  it, without creating anything: take the nominal dates for the next `seq`, add the
  recurring occurrences due in them at their default amounts, and carry the result into
  the one after. Repeat to the date asked for.

Nothing is written. Looking at a projection must never create a period or a transaction.

## Questions for the owner

1. **How far ahead?** Generation stops a year out. A projection writes nothing, so it can
   go further; two years is suggested.
2. **Just the number, or the working?** Suggested: one row per period (dates, starting
   amount, income, bills, what is left) so the answer can be checked, with the period
   asked about highlighted.
3. **"What if" amounts** (a one-off purchase, a raise) are not in the request. Left out
   unless asked for.

## Tasks

### 10.1 Projection engine

- [ ] Done

**Files:** new `src/shared/projection.ts` and `projection.test.ts`.

- A pure function: given the schedule, the last existing period (dates, `seq`, projected
  leftover) and the recurring items, return one entry per period through a given date:
  `{ seq, startDate, endDate, startingCents, incomeCents, expenseCents, projectedCents }`.
- Dates come from `nominalPeriod` exactly as `ensureThrough` uses them: start the day after
  the previous period really ends, end on the nominal end.
- Occurrences come from `occurrencesBetween` in `src/shared/recurrence.ts`, the function
  generation uses, so a projection and the period later generated always agree.

**Tests:** table-driven. The acceptance test that matters: project N periods ahead, then
actually generate them through the API, and the starting amounts match to the cent. Cover
weekly, biweekly and monthly, an item that ends part-way, an "every pay period" item, and a
last period whose end was moved by hand.

### 10.2 API

- [ ] Done

**Files:** new `src/server/services/projections.ts`, `src/server/routes/projections.ts`,
`src/server/app.ts`, `src/shared/projection.ts` (response type), `domain.md` (API list).

- `GET /api/projections?through=YYYY-MM-DD` → `{ periods: ProjectedPeriod[] }`: existing
  periods from the current one onward, then projected ones, each marked `exists`.
- Rejects a date beyond the limit agreed in question 1 with a field error on `through`.
- A period that is hand-set or flagged "may be out of date" is reported as such, since
  everything after it inherits the doubt.

**Tests:** the usual pair: correct for the owner, and another user's data never appears.
A request must leave the period and transaction counts unchanged.

### 10.3 The tab

- [ ] Done

**Files:** new `src/client/features/projections/` (`ProjectionsPage.tsx`, `api.ts`),
`src/client/router.tsx`, `src/client/features/shell/navItems.ts`.

- "Projections" in the side panel, between Home and Recurring.
- At the top: a date field, "Show me the period that starts on or contains…", defaulting
  to the next period. Below it the answer in words: "On Dec 23, 2026 you'd start with
  $4,210.55."
- Then the list from question 2: one row per period from now to that date. Rows for
  periods that exist link to them; projected ones are marked as not created yet.
- Empty and error states with the shared primitives. Works from 360px up; check at 375px
  and 1280px, light and dark.

## Implementation notes

None yet.
