# Phase 14: "On a schedule" or "As it happens"

**Goal:** whether a bill or income has a schedule is the first thing the dialog asks, in
plain sight, and the page can show only the ones that have none.

**Depends on:** phase 13 (task 13.2 added items with no schedule).
**Suggested model:** Sonnet. Client only, apart from one phrase in `src/shared/`.

**Status:** planned 2026-10-12 at the owner's request and built the same day. Checked in
a browser; not yet deployed, and the Android app has not been rebuilt with it.

## What the owner asked for

The owner went looking for the "not recurring" option and had to guess that it was in the
dropdown. It is: 13.2 put it last in the "Repeats" list, as "never (no schedule)". A
choice that changes what the whole item *is* should not be the fifth entry of a list about
how often it repeats.

## What is already there

- `recurrenceUnit: "none"` is the stored value, and everything on the server already
  handles it (no occurrences, optional amount, no first due date). **Nothing about the API
  or the database changes in this phase.**
- `BillOrIncomeDialog.tsx` already hides the interval, the first due date and the end date
  when the unit is `none`, relabels the amount "Usual amount (optional)" and says that
  nothing is added by itself. Only the way in is wrong.
- `BillsIncomePage.tsx` filters by search text, by kind (All, Bills, Income) and by "Show
  archived". `describeRecurrence` in `src/shared/recurrence.ts` says "No schedule", which
  is what the card and the detail show.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **One phrase for each side, used everywhere on screen: "On a schedule" and "As it
   happens".** "No schedule" and "never (no schedule)" go. The filter may shorten the
   first to "Scheduled" to fit.
2. **The switch is the first control in the dialog**, above the name, because it decides
   which fields follow. The name keeps the focus when the dialog opens.
3. **A new item still starts "On a schedule"**, monthly, as now. Most are.
4. **The filter is a second control beside the kind filter**, not a fourth segment in it.
   "Bills that happen as they happen" is a fair thing to ask for, and one control cannot
   say it.
5. **The stored value stays `"none"`**, and the MCP server keeps describing it as no
   schedule: an assistant reads the field's value, not the screen.

## Tasks

### 14.1 One phrase

- [x] Done

- `describeRecurrence` returns "As it happens" for `none`. That is the `scheduleText` the
  card, the detail dialog and the item's transactions page show.
- The empty state and the page subtitle already say "on a schedule or not"; bring them in
  line with the two phrases.
- The MCP server's lines for an item say "no schedule" in their own words (decision 5);
  check they do not print `scheduleText` and so change by accident. If they do, keep the
  assistant's wording as it was.

**Files:** `src/shared/recurrence.ts` and its test, `features/billsIncome/BillsIncomePage.tsx`,
`mcp/tools.ts` only if the check above finds something.

**Tests:** the table in `recurrence.test.ts`; `mcp/tools.test.ts` still passes unchanged.

### 14.2 The switch in the dialog

- [x] Done

- A `SegmentedControl` labelled "When", first in the form: **On a schedule** / **As it
  happens**. Under it, one line that changes with the choice: the schedule in words (as
  now), or "Nothing is added by itself. Tie transactions to it as they happen."
- It is not a new form field. It reads and writes `recurrenceUnit`: "As it happens" sets
  `none`; "On a schedule" puts back the unit and number that were there before (month and
  1 for an item that never had one). Keep the last scheduled unit in component state so
  flipping back and forth loses nothing.
- The "Repeats" list goes back to its four entries (months, weeks, years, pay period) and
  is only shown with "On a schedule". `repeatOptions` and `NO_SCHEDULE_OPTION` go.
- Editing an item that had no schedule and giving it one: the first due date starts as
  today, not the stored date (which for these is only the day the item was added). The
  existing line "Changes apply to periods generated from now on" already covers what
  happens next; nothing is back-filled by an edit.
- Everything else the dialog does for `none` stays: optional amount, no dates, no preview.

**Files:** `features/billsIncome/BillOrIncomeDialog.tsx`. `/dev/ui` needs nothing new;
`SegmentedControl` is already there.

**Check in the browser** (375px and 1280px, light and dark): add one of each kind; flip
the switch both ways with a custom "every 2 weeks" and see it come back; edit a scheduled
item to "As it happens" and back; the bottom sheet on a phone does not jump when the
fields under the switch appear and disappear.

### 14.3 The filter on the page

- [x] Done

- A second `SegmentedControl` in the toolbar: **Any** / **Scheduled** / **As it happens**.
  It combines with search, kind and "Show archived".
- Move `matches` out of the page into `features/billsIncome/filter.ts`, taking the four
  filter values, and give it a table-driven test. It is the only logic on the page worth
  one, and it is about to have four inputs.
- At 360px the toolbar wraps; each control keeps a 44px touch height and none widens the
  page. If three segments with "As it happens" do not fit a 328px row, let that control
  take the full row rather than shrinking the text.
- "Nothing matches" stays the empty result.

**Files:** `features/billsIncome/BillsIncomePage.tsx`, new `filter.ts` and `filter.test.ts`.

**Tests:** `filter.test.ts`: each filter alone, the combinations that matter (income +
as it happens; archived hidden unless asked for), search still matching the description.

## Implementation notes

### 14.1 to 14.3 (2026-10-12)

Built as planned, with these differences and additions:

- **The schedule in words stays under the Repeats row**, where it was, not under the
  switch as 14.2 said. It describes the fields beside it, and at the top of the dialog it
  would have changed while you typed further down. Under the switch there is a line only
  for "As it happens": "Nothing is added by itself. Tie transactions to it as they happen."
- **`SegmentedControl` gained `fitLabels`**: segments as wide as their own labels instead
  of equal widths. With equal thirds, "As it happens" wrapped onto two lines at 360px
  (103px segments, a 90px label, 24px of padding). The schedule filter uses it and is
  275px wide there. Labels in every segmented control no longer wrap. `/dev/ui` shows the
  variant.
- **The MCP server did print `scheduleText`**, so `billOrIncomeLine` in `mcp/format.ts`
  now says "No schedule" itself for such an item (decision 5). Its tests pass unchanged.
  **An MCP file built before this prints "As it happens"** once the server is updated;
  `npm run build:mcp` puts the assistant's wording back.
- The switch is not a form field. It writes `recurrenceUnit`, and the component remembers
  the last scheduled unit so that flipping to "As it happens" and back restores it. The
  number of weeks or months survives by itself: its field is only hidden.
- Editing an item that had no schedule starts its first due date at today.
- `features/billsIncome/filter.ts` holds `matchesFilters`, with 15 table-driven cases.
  The filter values in the code are `any`, `scheduled` and `unscheduled`.
- Checked in the browser on the dev account, at 1280px light and 360px dark, with a
  temporary bill: the switch is first and the name has the focus; "every 2 weeks" came
  back after a trip to "As it happens"; saved with no amount, the card read "As it
  happens"; the filter showed it alone under "As it happens" and hid it under
  "Scheduled"; reopened for editing, "On a schedule" offered monthly from today. Nothing
  on the page scrolls sideways at 360px. The bill was deleted afterwards.
- **Not checked:** saving the edit that gives an unscheduled item a schedule (the API
  rule is covered by `billsIncome.noschedule.test.ts`), and the dialog on the Android
  emulator.
- **Seen and left alone:** at 360px the label "Usual amount (optional)" wraps to two
  lines, which pushes its field a line below the Type control beside it. It has done so
  since 13.2.
- Checked by breaking the schedule filter once (scheduled and unscheduled swapped): 8 of
  the 15 cases fail.
- No component tests exist in this project, so the dialog has none.
