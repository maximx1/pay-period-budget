# Phase 9: Resetting a modified starting amount

**Goal:** a clear way to undo starting amounts that have been changed, now that periods
can exist before the budget's first one.

**Depends on:** phase 6 and the earlier-periods work (decision 12). **Suggested model:**
Opus. This is carry-forward arithmetic, where a budget silently goes wrong.

**Status: closed 2026-10-12, nothing to build.** The owner said what was meant: "if you
modify a starting amount for a period we should have a revert button or something next to
it that reverts it back to the actual calculated starting value." That is the **Use
calculated amount** button phase 6 built, described under "What exists today" below. It
was tried again on a copy of the dev database the same day: a period's starting amount set
to $5,000.00 by hand, carried forward, showed the pencil beside "Starting" and the line
"The starting amount was set by hand. Use calculated amount" in the summary card; pressing
it put that period and every later one back to the cent. The four wider readings (a) to
(d) below were guesses and are not wanted. If one ever is, it starts from this file.

*What follows is the plan as written on 2026-10-11, kept for the record.*

Planned 2026-10-11 at the owner's request. **Confirm the scope below with the
owner before building anything.** The request was one sentence, made while choosing how
earlier periods should treat money: "We're going to need a new phase added to implement
resetting a modified starting."

## What exists today

- A starting amount set by hand is pinned (`startingMode = manual`). The summary card and
  Period settings both offer **Use calculated amount**, which reverts that one period and
  recalculates the periods after it up to the next pinned one.
- A period whose starting amount may be out of date offers **Recalculate**.
- The first period's calculated amount is the opening balance typed at setup. Reverting
  it goes back to that.
- Periods before the budget began cannot have their starting amount set or reverted at
  all: it is always worked back from the first period (`domain.md`, "Periods before the
  budget began").

So resetting *one* hand-set amount already works. The phase is about what that does not
cover.

## Questions for the owner

1. **Which of these is the request?** They are not exclusive.
   - **(a) Reset everything.** One action that clears every hand-set starting amount and
     recalculates the whole budget from the first period forward.
   - **(b) Start the budget earlier.** Having filled in earlier periods, say "my budget
     really starts here": type what you had at the start of the earliest period and let it
     carry forward through every period after, replacing the opening balance. This is the
     "carry forward into today's numbers" option the owner did not pick as the default; it
     would become a deliberate, one-time action.
   - **(c) Edit history.** Allow an earlier period's starting amount to be typed, with a
     way to put it back.
   - **(d) Change the opening balance** itself after setup, without marking the first
     period as hand-set.
2. **Should a reset be undoable?** (a) and (b) rewrite many periods at once.
3. **What happens to "may be out of date" flags** after a reset: cleared everywhere?

## Tasks

Sketched for (a) and (b), the likeliest reading. Rework once the questions are answered.

### 9.1 Recalculate the whole budget

- [ ] Done

**Files:** `src/server/services/carry.ts`, `src/server/services/periods.ts`,
`src/server/routes/periods.ts`, `src/shared/budget.ts`, a test file beside the others.

- `POST /api/budget/recalculate` with `{ preview?: boolean }`: set every period from 0
  onward to `auto`, run `recomputeChain` from 0 with the opening balance, clear every
  stale flag, then `shiftHistory` by however much period 0 moved.
- The response lists each period whose starting amount changes, before and after, so the
  client can show what a reset will do before it is confirmed. With `preview` nothing is
  written.

**Tests:** hand-set amounts in several periods all return to calculated; flags clear;
earlier periods still end on period 0's starting amount; another user's budget is
untouched; preview writes nothing.

### 9.2 Start the budget from an earlier period

- [ ] Done

- `POST /api/budget/rebase` with `{ startingCents, preview? }`: the earliest period becomes
  the budget's first. Its starting amount is the one given; every later period, including
  the old first one, becomes `auto` and is recalculated forward from it.
- Decide how this is stored: either renumber so the earliest period is `seq` 0 and move the
  anchor date and opening balance to it, or keep the numbering and add a "budget begins at
  seq" marker to the schedule. Renumbering keeps one rule ("0 is first") at the cost of a
  migration-style rewrite of every period's `seq`.
- This changes today's balances. Preview is mandatory in the UI.

**Tests:** after a rebase the chain is forward-only from the new first period; no period
is left with a negative `seq`; the old opening balance no longer affects anything.

### 9.3 Screens

- [ ] Done

**Files:** `src/client/features/settings/BudgetSection.tsx`,
`src/client/features/periods/*`.

- Settings → Budget: "Recalculate all starting amounts", and, when earlier periods exist,
  "Start my budget from <earliest date>". Each opens a dialog showing the preview (how many
  periods change, and today's leftover before and after) with a confirm button.
- Follow the dialog conventions in `CLAUDE.md`; check at 375px and 1280px, light and dark.

## Implementation notes

None yet.
