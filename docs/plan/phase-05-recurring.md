# Phase 5: Recurring items (bills and income)

**Goal:** define recurring bills and income once, and have them show up as upcoming
transactions in each period automatically.

**Depends on:** phase 4. **Suggested model:** Sonnet; have Opus review 5.3, where
generation and carry-forward meet.

**Read first:** `domain.md` section "Recurring items" in full.

**Naming:** these are *recurring items* everywhere: table `recurring_items`, column
`transactions.recurring_id`, API `/api/recurring`, client folder `features/recurring`,
nav label "Recurring". Do not call them accounts; that word belongs to a later feature.

**No new dependencies.**

## Tasks

### 5.1 Recurrence math (pure)

- [ ] Done

**Files:** new `src/shared/recurrence.ts`, `src/shared/recurrence.test.ts`.

```ts
export const RECURRENCE_UNITS = ["week", "month", "year", "period"] as const;
export type Recurrence = {
  unit: RecurrenceUnit; interval: number; firstDueDate: LocalDate; endDate: LocalDate | null;
};

/** Occurrence dates within [from, to], inclusive. For unit "period" pass the period's start. */
occurrencesBetween(rule: Recurrence, from: LocalDate, to: LocalDate, periodStart: LocalDate): LocalDate[]
nextOccurrence(rule: Recurrence, onOrAfter: LocalDate): LocalDate | null   // null for "period" or when ended
describeRecurrence(rule: Recurrence): string
```

- Follow the formulas in `domain.md`. Compute month and year occurrences from
  `firstDueDate` + k × interval (never by stepping from the previous occurrence) so
  clamping doesn't drift. Jump straight to the first k that can land in range rather than
  iterating from k = 0.
- `period`: returns `[periodStart]` if `from <= periodStart <= to`, `periodStart >=
  firstDueDate` and it is not after `endDate`; otherwise `[]`.
- `describeRecurrence` examples: "Every month on the 25th", "Every 2 weeks on Saturday",
  "Every week on Friday", "Every 3 months on the 1st", "Every year on Mar 15",
  "Every pay period"; append ", until Oct 12, 2027" when `endDate` is set. A monthly rule
  on the 29th–31st reads "on the 31st (or last day)".

**Tests:** monthly on the 25th across a biweekly period that contains it, one that doesn't,
and a monthly period; monthly on the 31st through February; biweekly Saturdays across four
consecutive biweekly periods (expect exactly one each when aligned, and the 0/1/1/… pattern
when not); weekly inside a monthly period (4 or 5); yearly Feb 29; interval 3 months;
`endDate` on, before and after an occurrence; `from` before `firstDueDate`; `period` unit
in and out of range; every `describeRecurrence` example above.

### 5.2 Tables, repository and CRUD endpoints

- [ ] Done

**Files:** `src/server/db/schema.ts`, migration `--name recurring_items`,
`src/server/repos/types.ts`, new `src/server/repos/sqlite/recurring.ts`,
`src/server/repos/sqlite/transactions.ts`, `src/server/repos/sqlite/index.ts`,
new `src/shared/recurring.ts`, new `src/server/services/recurring.ts`,
new `src/server/routes/recurring.ts`, `src/server/app.ts`,
new `src/server/routes/recurring.test.ts`.

- Create `recurring_items`. Add `recurring_id` (references `recurring_items`, on delete set
  null) and `occurrence_date` to `transactions`, with the partial unique index from
  `domain.md`. Check the generated SQL: SQLite can add these columns in place; if
  drizzle-kit instead rebuilds the table, make sure existing rows are copied.
- `Transaction` responses gain `recurringId: string | null`.
- `RecurringRepo`: `findById`, `list(userId)`, `create`, `update`, `delete`.
  `TransactionRepo` gains `createIfAbsent(tx)` (insert, do nothing on the
  `(recurring_id, occurrence_date)` conflict, return whether it inserted) and
  `listUpcomingForRecurringAfter(userId, recurringId, date)`.
- `recurringInputSchema`: `{ name: 1–80 chars, description: ≤ 2000 chars (default ""),
  kind: "expense" | "income", defaultAmountCents: positive integer, recurrenceUnit,
  recurrenceInterval: integer 1–52 (default 1), firstDueDate, endDate: LocalDate | null }`
  with a refinement that `endDate >= firstDueDate`. `recurringPatchSchema` is the partial
  version.
- `RecurringItem` response adds computed fields: `archived: boolean` (end date before today
  in the budget's time zone), `nextDueDate` (`nextOccurrence` from today, null if none or
  the unit is `period`) and `scheduleText` (`describeRecurrence`).
- Endpoints: `GET /api/recurring` (all, including archived; the client filters),
  `POST /api/recurring`, `PATCH /api/recurring/:id`, `DELETE /api/recurring/:id`.
  In this task create, patch and delete only touch the `recurring_items` table; task 5.3
  adds the transaction side effects.

**Tests:** CRUD round trip; validation failures per field; `archived` flips when the clock
passes `endDate`; deleting an item leaves a transaction that pointed at it in place with
`recurringId` null; cross-user 404s.

### 5.3 Generating transactions from recurring items

- [ ] Done

**Files:** `src/server/services/recurring.ts`, `src/server/services/periods.ts`,
new `src/server/services/materialize.ts`, `src/server/routes/recurring.ts`,
`src/server/routes/recurring.test.ts`, `src/server/routes/periods.test.ts`.

`materialize.ts`: `materializeInPeriod(repos, item, period, now)` computes
`occurrencesBetween` for the period and inserts each with `createIfAbsent`, following
"Turning occurrences into transactions" in `domain.md`. Returns the count and the summed
signed amount actually inserted. A `dryRun` flag computes both without writing.

Wire it into the two moments from `domain.md`:

1. **Period generation**: in `ensureThrough`, at the hook left in task 3.3, run it for
   every recurring item of the user against each newly created period. No leftover delta
   is needed for the new period itself, but the *next* period created in the same loop
   must read the previous projected leftover *after* materialisation. Add a test that
   would fail if the order were wrong.
2. **Item creation**: after inserting the item, for **every** existing period in ascending
   `seq`: materialise, then `applyLeftoverDelta` after that period with the inserted sum.
   Periods that end before `firstDueDate` naturally get nothing. There is no "today"
   cut-off: a first due date in the past back-fills, as `domain.md` describes.

`POST /api/recurring/preview` takes the same body as create and returns, without writing,
`{ transactions: number, periods: number, pastPeriods: number, earliestDate: LocalDate | null }`
where `pastPeriods` counts affected periods that ended before today. The dialog uses it
to warn before a back-fill.

Also add `POST /api/recurring/:id/end` with body `{ removeUpcoming: boolean }`: sets
`endDate` to today; when `removeUpcoming` is true, deletes that item's `upcoming`
transactions dated after today and applies the leftover deltas.

Editing or deleting a recurring item performs **no** transaction changes (assert it in a
test), including when `firstDueDate` is edited.

**Tests:**
- A monthly bill on the 25th with a biweekly budget, first due this month: after creation,
  the existing period containing the 25th has one upcoming transaction for the default
  amount, named after the item; stepping forward to the horizon yields exactly one per
  calendar month across all generated periods, none duplicated and none missing.
- An income item with unit `period` adds one positive transaction on the first day of the
  period containing its first due date and of each later one.
- The leftover invariant from 4.2 holds across the whole chain after creating two items and
  generating six periods.
- **Back-fill:** with four existing periods, create an item whose first due date is in the
  second: periods two to four each get their occurrences; period one gets none; starting
  amounts of periods three and four (and any later ones) shift by the right totals; the
  transactions arrive as `upcoming`.
- Back-fill with a manual starting amount on period three (once phase 6 exists, or by
  setting the column directly in the test): the delta from period two stops there.
- A first due date before the first period: occurrences before the first period are
  skipped, later ones are created.
- `preview` returns the same counts the real create then produces, and writes nothing.
- `firstDueDate` in the future: nothing before it. `endDate`: nothing after it.
- Changing `defaultAmountCents` leaves existing transactions alone and is used by the next
  generated period.
- Editing a generated transaction's amount or date, then generating more periods, leaves
  the edit in place and creates no duplicate for that occurrence.
- Deleting a generated transaction, then calling `current` again, does not bring it back.
- `end` with `removeUpcoming: true` removes future upcoming ones only (paid ones and past
  ones stay) and repairs downstream starting amounts.

### 5.4 Recurring page

- [ ] Done

**Files:** new `src/client/features/recurring/api.ts`, `RecurringCard.tsx`,
`RecurringDialog.tsx`, `Linkified.tsx`; new `src/shared/links.ts`,
`src/shared/links.test.ts`; `src/client/features/recurring/RecurringPage.tsx`.

- `links.ts`: `splitLinks(text): Array<{ type: "text" | "link"; value: string }>`
  recognising `http://` and `https://` URLs only, and not swallowing trailing punctuation
  (`.`, `,`, `)`, `!`, `?`). `Linkified` renders the parts, links as
  `<a target="_blank" rel="noopener noreferrer">` with visible link styling, and preserves
  line breaks (`whitespace-pre-wrap`). Never use `dangerouslySetInnerHTML`.
  **Tests:** plain text, a URL mid-sentence, a URL followed by a period, two URLs,
  `javascript:` and `data:` left as text, a URL in parentheses.
- Page: `PageHeader` with an "Add recurring" button; a toolbar with a search box (filters
  by name and description, case-insensitive, as you type), a segmented filter All / Bills /
  Income, and a "Show archived" toggle (off by default). Filtering is client-side.
- Card grid: 1 column on phones, 2 from `md`, 3 from `xl`, 4 from `2xl`.
- `RecurringCard`: name, amount (income in the primary colour with `+`), `scheduleText`,
  "Next: Mon, Oct 26" when `nextDueDate` exists, the description through `Linkified`
  (clamped to four lines with a "more" toggle), and an "Archived" badge with muted styling
  when archived. An edit `IconButton` opens the dialog.
- `RecurringDialog` (add and edit): Name; Bill / Income; Amount; Repeats: "Every [n]
  [weeks | months | years]" or "Every pay period"; First due date (default today); "Ends"
  (optional date); Description (textarea). Show a live preview line under the schedule
  fields using `describeRecurrence`.
  - **Add mode, back-fill warning:** whenever the form is valid, call `preview`
    (debounced). Show what saving will do: "Adds 1 transaction to this period." When
    `pastPeriods > 0`, show it as a warning instead: "Adds 3 transactions across 3 periods,
    2 of them already over. They will arrive unpaid, and the leftover carried through
    later periods will change." No extra confirmation step; the warning is enough.
  - **Edit mode:** a muted note: "Changes apply to periods generated from now on. Existing
    transactions stay as they are." No preview.
  - Edit mode also has "End this" (confirmation with a "Also remove its upcoming
    transactions" checkbox, checked by default → `POST .../end`) and "Delete".
- After create or end, invalidate `["period", ...]` queries as well as `["recurring"]`.
- On the home view, rows that came from a recurring item show a small repeat icon.

**Accept when:** creating "Internet, $60, every month on the 12th" makes it appear on the
home view for the right period without a reload; a first due date two periods back shows
the warning with the right counts and, after saving, those periods contain the
transactions; a description containing a URL renders a working link; archived items are
hidden until the toggle is on.

## Implementation notes

(Add notes here as tasks are completed.)
