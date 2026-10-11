# Phase 4: Transactions and the home view

**Goal:** the home screen becomes usable day to day. You can add a one-off transaction with
the floating + button, see Upcoming and Paid sections with running totals, move items
between them with one tap, edit or delete them, and watch the leftover carry into later
periods.

**Depends on:** phase 3. **Suggested model:** Sonnet.

**Read first:** `domain.md` sections "Which transactions belong to a period", "Totals",
"Carrying leftover forward" and "Transactions".

**No new dependencies.**

## Tasks

### 4.1 Table and repository

- [x] Done

**Files:** `src/server/db/schema.ts`, migration `--name transactions`,
`src/server/repos/types.ts`, new `src/server/repos/sqlite/transactions.ts`,
`src/server/repos/sqlite/index.ts`, new `src/server/repos/sqlite/transactions.test.ts`.

Create `transactions` as listed in `domain.md`, **without** `recurring_id` and
`occurrence_date` (phase 5 adds them). `status` is text, `sort_order` integer default 0.

```ts
TransactionRepo
  findById(userId, id)
  listInRange(userId, startDate, endDate)   // inclusive dates; ordered occurs_at, sort_order, created_at
  sumInRange(userId, startDate, endDate)    // { paidCents, upcomingCents }
  create(tx)
  update(userId, id, patch, now)
  delete(userId, id)
```

Range filtering compares `occurs_at >= start + "T00:00"` and
`occurs_at < (end + 1 day) + "T00:00"`.

**Tests:** a transaction at `T00:00` on the start date and one at `T23:59` on the end date
are both inside; one a minute later is outside; ordering by the three keys; sums split by
status; cross-user isolation for find, update and delete.

### 4.2 Service, carry-forward and endpoints

- [x] Done

**Files:** new `src/shared/transactions.ts`, new `src/server/services/transactions.ts`,
new `src/server/services/carry.ts`, `src/server/services/periods.ts`,
new `src/server/routes/transactions.ts`, `src/server/app.ts`,
new `src/server/routes/transactions.test.ts`.

Shared schemas:
- `transactionInputSchema`: `{ name: trimmed 1–100 chars, amountCents: positive integer ≤
  100_000_000, kind: "expense" | "income", occursAt: LocalDateTime, note?: ≤ 500 chars,
  paid?: boolean }`.
- `transactionPatchSchema`: every field optional, plus `status?: "upcoming" | "paid"`.
  At least one field required.
- `Transaction` response type: `{ id, name, amountCents (signed), kind, occursAt, status,
  paidAt, note, sortOrder }`.

`carry.ts`: `applyLeftoverDelta(repos, userId, afterSeq, deltaCents)` exactly as in
`domain.md`, including the stop at a `manual` period (none exist yet; the rule still goes
in now). A zero delta returns immediately.

`transactions.ts` service; every method runs in one `store.transaction`:
- `create`: `ensureThrough(date)` (its rejection becomes a field error on `occursAt`),
  insert, then apply `+amount` after the containing period.
- `update`: load, apply the patch, then apply deltas per the table in `domain.md` (handle
  amount change, kind flip and date move together: remove the old signed amount after the
  old period, add the new signed amount after the new period; skip when nothing changed).
  A `status` change sets or clears `paidAt`.
- `remove`: delete, then apply `−amount`.

`periods.ts`: `getView` now returns the period's transactions and real totals, and
`projectedOf` includes the transaction sum.

Routes behind `requireAuth`: `POST /api/transactions` (201), `PATCH /api/transactions/:id`,
`DELETE /api/transactions/:id` (204). Create and patch respond with
`{ transaction: Transaction }`.

**Tests:**
- Create an expense in the current period: it appears in the view under upcoming; totals
  match; the *next* period's `startingCents` dropped by the amount, and so did the one
  after.
- Income raises them. Marking paid moves the amount from upcoming to paid, leaves leftover
  and downstream starting amounts unchanged, and sets `paidAt`; marking upcoming clears it.
- Editing the amount shifts downstream starting amounts by the difference only.
- Changing the date into the next period: the transaction leaves the old view and enters
  the new one; the next period's starting amount goes back up by the amount; the period
  after that is unchanged overall.
- Changing the date into a period that doesn't exist yet (within the horizon) generates it.
- A date before the first period, or past the horizon → 400 with `fields.occursAt`.
- Delete restores downstream starting amounts.
- Validation: zero, negative, fractional and oversized amounts; empty name; bad date-time.
- Another user gets 404 on patch and delete, and never sees the transaction in a view.
- A property-style check: after a scripted sequence of ~30 mixed creates, edits, moves and
  deletes, every period's `startingCents` equals the previous period's
  `startingCents + sum of its transactions`.

### 4.3 Transaction lists on the home view

- [x] Done

**Files:** new `src/client/features/transactions/api.ts`, `TransactionSection.tsx`,
`TransactionRow.tsx`; `src/client/features/home/HomePage.tsx`.

- Two sections, **Upcoming** then **Paid**. Each has a header with its title, item count
  and total (`formatCents`). Stacked on small screens; side by side in two columns from
  `xl` up so an ultrawide shows both without scrolling.
- Rows are grouped under a small date label (`formatDay`) so same-day items read together.
  A row shows the name, the time if it isn't `00:00`, the note (one line, truncated), and
  the amount right-aligned (income prefixed `+` in the primary colour; expenses plain).
- Each row has a status button on its leading edge: an empty circle in Upcoming ("Mark
  paid") and a filled check in Paid ("Move back to upcoming"). It is an `IconButton` with a
  proper label, 44px target.
- Toggling is optimistic: update the cached `PeriodView` immediately (move the row, adjust
  `paidCents`, `upcomingCents` and `leftoverCents`; `projectedCents` does not change), roll
  back and toast on failure.
- Tapping the rest of the row opens the edit dialog (task 4.4).
- Each section shows an `EmptyState` with an icon when it has no rows, so neither ever
  collapses to a bare header: Upcoming → `CalendarClock`, "Nothing upcoming", "Add a
  transaction with the + button."; Paid → `CircleCheck`, "Nothing paid yet", "Items you
  mark as paid move here."
- After any create, edit or delete, invalidate every `["period", ...]` query: other
  periods' starting amounts may have changed.

**Accept when:** with a handful of transactions the totals in both headers and in the
summary always agree with the rows after toggling back and forth quickly.

### 4.4 Add and edit dialog

- [x] Done

**Files:** new `src/client/features/transactions/TransactionDialog.tsx`,
`src/client/features/home/HomePage.tsx`.

- A `Fab` with a + icon ("Add transaction") on the home view opens the dialog in add mode.
- Fields: Name (autofocus); Amount (text input with `inputMode="decimal"`, parsed by
  `parseMoneyInput`); a two-option segmented control Expense (default) / Income; Date and
  time (`<input type="datetime-local">`); Note (optional, collapsed behind "Add a note").
- Default date-time when adding: now if today is inside the period being viewed, otherwise
  that period's start date at `00:00`.
- "Already paid" checkbox in add mode.
- Edit mode pre-fills everything, shows a Delete button (danger, with an inline "Delete?
  Yes / No" confirmation rather than a second dialog) and a Save button.
- If the saved date falls outside the period on screen, close the dialog and toast
  "Moved to Oct 16 – Oct 29" with the destination's date range.
- Map server field errors with `applyApiError`.

**Accept when:** adding "Bag of ice, 3.49" takes four interactions (+, name, amount, Add)
and the totals update; the dialog is fully usable at 375px with the keyboard open (actions
remain reachable).

## Implementation notes

Completed 2026-10-10. Where the build differs from the task text above, this section wins.

- **Create and update respond with `{ transaction, period }`**, where `period` is
  `{ id, startDate, endDate }` of the period the transaction now falls in. The dialog
  compares that id with the period on screen to decide whether to say "Added to …" or
  "Moved to …".
- **PATCH semantics for money:** `amountCents` is always the positive magnitude and `kind`
  the direction. Sending only `amountCents` keeps the direction; sending only `kind` flips
  the sign. `note: ""` or `null` clears the note. A `status` equal to the current one
  leaves `paidAt` alone.
- **`paidAt`** is an ISO instant string in responses.
- **`applyLeftoverDelta(repos, userId, afterSeq, deltaCents, now)`** lives in
  `services/carry.ts` and already stops at a manual period (tested by setting the column
  directly). Phase 6 adds `recomputeChain` beside it.
- **`toTransaction`** is in `services/transactionMapper.ts` so both the period and the
  transaction service can use it without importing each other.
- **Phase 5 hooks:** recurring items insert through the same `transactions` table; add
  `recurring_id` / `occurrence_date` there, `recurringId` to `toTransaction`, and the
  repeat icon in `TransactionRow`.
- **How amounts are shown:** a row shows an expense unsigned ("$27.00") and income with a
  plus in the primary colour ("+$1,850.00"). Section headers and the summary's Paid and
  Upcoming show the *net* of their rows, signed ("-$315.50", "+$815.88").
- **Optimistic paid toggle:** `features/transactions/optimistic.ts` (`withStatus`, unit
  tested) rewrites every cached period view. The refetch after saving is skipped while
  other toggles are still in flight, so rapid tapping never shows stale server data.
- **New primitive `SegmentedControl`** (a radio group styled as segments), also on
  `/dev/ui`. Phase 5 can use it for Bill / Income and the All / Bills / Income filter.
- **`HomePage` keeps the last edited transaction in state after the dialog closes** so the
  title doesn't flip to "Add transaction" during the fade-out.
- **Layout lesson:** a CSS grid column defaults to a minimum width of its content, so one
  long name pushed the lists off the side of a phone. Always give a grid an explicit
  column count (`grid-cols-1 xl:grid-cols-2`), which sets the minimum to zero.
- **`index.html`** now sets `interactive-widget=resizes-content` so the bottom sheet's
  buttons stay above the on-screen keyboard on Android.
- New shared helpers: `formatTime`, `centsToInput`, and `parseMoneyInput(…, { allowNegative })`.
- Checked in the browser at 375px and 1440px, dark and light: add by keyboard (name, Tab,
  amount, Enter), validation messages, mark paid and back (including seven rapid toggles,
  after which screen and server agreed), edit with prefilled values, moving to another
  period (toast, generated on demand, later starting amounts corrected), delete with
  confirmation, two-column layout from `xl`, and long-name truncation on a phone.
