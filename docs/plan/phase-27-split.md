# Phase 27: Split it up

Asked for 2026-10-21. Built the same day on `main`; not yet deployed.

## What it is

A third tab in the add dialog, "Split it up": one or more amounts, each due by a date,
spread evenly over the pay periods up to it and saved as one ordinary transaction per
period. The owner's examples: $432.67 due March 5; two or three "pay in 6 months, no
interest" purchases at once, each with its own due date, summed into one transaction a
period.

It is a batch way of making normal transactions. Nothing ties them together afterwards
unless they are tied to a bill or income, which is optional, as on the "Type it in" tab.
(Since [phase 31](phase-31-split-changes.md) the split is kept and its transactions point at
it, so it can be added to, have a payment skipped, and round its payments up to $50.)

## How it works

- **Periods covered.** From the first payment's period through the period the due date
  falls in. Each later payment is dated on its period's first day, so it is always on or
  before a due date that period holds. **"Finish a pay period early"** (a checkbox per
  split) ends each item in the period before the one it is due in. In the owner's example,
  biweekly from Oct 9 with Mar 5 due, that is 11 transactions by default and 10 with the box
  ticked.
- **First payment.** The form's own date field ("First payment"): now when the current
  period is on screen, otherwise the first day of the period on screen, as for any new
  transaction.
- **Even split.** Whole cents that differ by at most one; the earliest payments take the
  extra cents (`splitEvenly` in `src/shared/split.ts`). $432.67 over 11: four of $39.34,
  seven of $39.33.
- **Several items.** Each is spread over its own periods, all starting together, and a
  period's transaction is the sum of their shares (`planShares`). Each item then needs a
  name ("What it is"). The first item takes the transaction's name when a second is
  added.
- **Name and note.** One name for every transaction. With several items each note lists
  what each item makes up of that payment, after the split's own note:
  "No interest until March · Laptop $43.27 + Couch $30.00" (`splitNote`).
- **Same options as a normal transaction.** Type (Expense, Income, Transfer with its
  direction), the recurring item it belongs to (a bill or income), Category (including making a new category or transfer as it
  saves) and Note. Not "Counts toward" or "Already paid": every payment starts upcoming.
- **Past the furthest pay period.** Periods can exist only up to a year ahead. A split
  whose due dates are further out still works out every share over the whole span to the
  real due date (asked for 2026-10-21: "honor the real split values"), and makes the
  transactions up to that furthest period. The rest are saved as **waiting payments**,
  exactly as worked out (date, amount, note, bill or income, category), and the preview
  lists them under "Not added yet". A due date may be up to five years after the first
  payment.
- **Reminder for waiting payments** (asked for the same day; the owner's "hybrid"). Each
  payday one more waiting payment comes within reach, and a reminder every two weeks
  would nag, so a card on the home screen ("Split payments ready to add") comes up for a
  split only when **everything it has left can be added**, or when **three** of its
  payments can (`SPLIT_REMIND_AFTER`, `waitingStatus` in `src/shared/split.ts`). Its Add
  button adds the ones in reach as ordinary transactions; the count then starts again. A
  two-year promotion is added in batches of three, about every six weeks on a biweekly
  budget.
- **Split payments page** (`/splits`). Every split with payments waiting: each payment,
  which are "Ready", "Add N now", and "Drop the rest" (what was added stays). It is in the
  side panel only while something waits.
- **Preview.** As the form changes the client asks the server for a dry run (debounced
  300ms) and lists every transaction it would make, with each item's share when there are
  several. A refused field (a due date before the first payment, a year ahead) is marked
  on that field. The Add button says how many it will add.

## Server

`POST /api/transactions/split` (`services/split.ts`): validates the due dates, makes the
periods it needs (`extendToward`, never before the earliest), works out the payments
against the real periods (so a period with hand-moved dates is respected), then hands them
to the import's own code (`imports.importIn`, inside the same database transaction) to
check links, save, and carry once per period. What can't be made yet goes to
`split_waiting_payments` (migration `0014`) under one `splitId`. Periods past the last one that exists after
that are numbered on from it with the schedule's nominal dates, the first starting the day
after the last one's (possibly hand-moved) end, as generation will make them. `dryRun` does all of it and rolls back, so
the preview is exactly what a real run saves. Link errors from the import
("transactions.3.categoryId") are reported on the split's own field ("categoryId").

Refused, with nothing saved: a due date before the first payment; a due date more than
five years after it; a first payment more than a year ahead; finishing early something due in the first payment's own period; a first
payment before the earliest period; with several items, one unnamed; a period's total over
$1,000,000; a note that the breakdown makes longer than 500 characters; another user's (or
no such) bill or income or category, refused exactly as one that doesn't exist.

## Decisions (overrule any)

- Last share in the due date's period by default, with "Finish a pay period early" to
  end it one period sooner. It is a checkbox in the split, not a setting in Settings. The
  owner suggested "maybe a setting"; a remembered default can be added if the box is
  ticked every time.
- Extra cents go to the earliest payments, so the money is set aside sooner.
- Later payments are dated at the start of their period (midnight), not at the first
  payment's time of day.
- Up to 10 items in one split; item names up to 40 characters; due dates up to five years
  after the first payment.
- Waiting payments keep the category the saved ones got: the one named, else the bill or
  income's own. A bill or category deleted meanwhile is simply left off (set null).
- The reminder shows on the home screen whichever period is on screen; it has no "not
  now": it goes away when its payments are added or dropped.
- "The first can be added around <date>" on the Split payments page is a year before the
  payment's date, which is close; the server decides exactly.

## Server: waiting payments

`GET /api/splits` lists each split's waiting payments with `inReach` and `remind`;
`POST /api/splits/:id/add` adds those in reach (409 when none are; all or nothing, through
the import code); `DELETE /api/splits/:id` drops the rest. Another user's split is a 404,
like one that doesn't exist. `periods.reachEnd` is the last day a period may cover today.
- The add dialog's tabs are "Type it in", "Screenshots" (was "From screenshots") and
  "Split it up", shortened so all three fit at 360px. Without the screenshot picker (no
  `onScan`) the dialog still shows "Type it in" and "Split it up".
- No MCP tool for it yet; an assistant can still make the same transactions through the
  import.

## Verified

- `npm run check` (see the count in HANDOFF.md). `src/shared/split.test.ts` (the arithmetic,
  the note, the schema) and `src/server/routes/transactions.split.test.ts` (the API:
  periods covered, finishing early, running past the furthest period (including after its
  end was moved by hand), several items, ties and categories, dry run equals the
  real run, every refusal, another user's bill or category, signing in). Making
  "finish early" a no-op on purpose failed two of them.
- In a browser against the dev server (biweekly from 2026-10-09, today 2026-10-21): the
  owner's $432.67 due 2027-03-05 previewed 11 transactions Oct 21 to Feb 26, and 10 to
  Feb 12 with "Finish a pay period early"; a second item ($120 due Dec 15) added $30.00 to
  the first four; a due date before the first payment was marked on its field; saving made
  the 10 transactions with the notes above and the toast "Added 10 transactions, Wed, Oct 21
  to Fri, Feb 12". At 1280px light and 360px dark: no horizontal overflow, the three tabs
  fit. "Type it in" still refuses an empty amount; editing a transaction still saves.
- Past the furthest period, in the browser: $1,000 due 2028-01-15 previewed 27 transactions
  (Oct 21, 2026 – Oct 8, 2027) and "Not added yet: $205.87" (seven of $29.41, Oct 22, 2027 to
  Jan 14, 2028); saving made exactly the 27 ($794.13). The toast for a $50 one read "Added 27
  transactions, Oct 21, 2026 – Oct 8, 2027. $11.39 more falls from Oct 22, 2027: split it
  again later." No overflow at 360px. (That toast now says the rest "waits under Split
  payments".)
- Waiting payments: `src/server/routes/splits.test.ts` (13 tests: what waits and with
  which note and category; the reminder at one, two and three payments in reach, and when
  the last is; adding, including after its bill was deleted; refusing when none is in
  reach; dropping; signing in; another user's). Letting `listSplit` ignore the user failed
  the other-user test. In the browser: a split of two items to 2028 left 7 waiting; the
  page listed them with years (1280px light, 360px dark, no overflow); with three moved a
  year sooner in the dev database (as if paydays had passed) the home card offered "3
  payments, $100.23 · 4 more after"; Add made the three with their notes, toasted "Added 3
  Furniture payments, Oct 22 – Nov 19, 2026. 4 still waiting" and the card went away;
  "Drop the rest" emptied the page and kept what was added; the side-panel entry went
  once nothing waited.

## Not verified

- The reminder arising from real time passing in a browser (the API tests move the clock;
  the browser check moved dates in the database instead).
- On the Android app (it needs `npm run build:android`).
- A split tied to a transfer, or making a new category from the split tab, in the browser
  (the same code as the "Type it in" tab; the API test covers a bill and a category).
