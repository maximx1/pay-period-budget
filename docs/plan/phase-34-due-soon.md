# Phase 34: Due soon, and adding the payment from the warning

Asked for 2026-10-23 and built the same day on `main`, after [phase 25](phase-25-due-dates.md)
and [phase 33](phase-33-late-payments.md); not yet deployed. No migration. Rules: "Due
dates" in [domain.md](domain.md).

## What the owner asked for

> The warning message for the coming soon payment should have a button to add the
> transaction with most of the dialog filled in for it. And then just to double check. If
> we're like 3 days out, and the transaction isn't in the paid column yet, there is a more
> red warning message declaring urgency right?

There was no such urgent warning: an upcoming payment counted as "set to pay it", so three
days out with the payment still unpaid showed nothing at all. It was built here.

## Decided (overrule any)

1. **Soon is three days** (`DUE_SOON_DAYS`): from three days before the due date through
   the day itself. Its notice is `urgent`, drawn as the red "danger" alert, and says how
   soon ("in 3 days", "tomorrow", "today").
2. **Not paid yet counts only when soon.** A due date covered by upcoming payments alone,
   none marked paid, gets an urgent notice in that window naming the earliest of them
   (`unpaidDate`). Far off, it says nothing, as before. Once the day has passed it says
   nothing more: the unpaid payment is still there in the period to be dealt with.
3. **An uncovered due date is red in the window too**, and an ordinary warning before and
   after it, as before.
4. **"Add payment"** appears on a notice with nothing set to pay it (not on one naming a
   late payment or an unpaid one, where a second payment would pay it twice). It opens the
   add dialog's "Type it in" tab tied to the item, named after it, money out, for its usual
   amount (blank without one), filed under its category, dated on the due date, or today
   once that has passed.
5. **The MCP period report** says `DUE (URGENT)` for an urgent notice and names an unpaid
   payment's date.

## What was built

- `src/shared/dueDates.ts`: `DuePayment.paid`, `isDueSoon`, and `dueNoticeFor` in place of
  `uncoveredDue`; `DueNotice` gains `unpaidDate` and `urgent` (optional, for older
  servers); `dueNoticeMessage` says how soon.
- `dueNoticesIn` takes today; the period view passes the budget's today.
- `TransactionDialog` takes `prefill` (the "Type it in" form's starting values).
- Home: red or amber per notice, with the button.

## Checked

- `npm run check`: 1444 tests in 67 files: table rows for `dueNoticeFor` (paid, unpaid,
  late, the edges of the three-day window) and the wording, and two API tests driving the
  clock (urgent from three days out; an unpaid payment warns until it is marked paid).
- In the browser on the local `sample` account (bill and payment removed afterwards), on
  Oct 23 with a bill due Oct 25 and a usual amount of $45: a red "is due Oct 25, in 2 days,
  and nothing is set to pay it by then" with "Add payment"; the button opened the dialog
  named, $45.00, money out, Oct 25, tied to the bill; saved unpaid, the warning became "its
  payment on Oct 25 isn't marked paid yet"; marked paid, it went away.

## Not checked

- At phone width; the Android app (not rebuilt).
- An older server: the app shows its notices as before (amber, never urgent), and the
  button still works, as it needs only the item and the due date.
