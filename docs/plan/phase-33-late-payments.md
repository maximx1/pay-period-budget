# Phase 33: Marking a payment late

Asked for 2026-10-23 and built the same day on `main`, after [phase 25](phase-25-due-dates.md);
not yet deployed. Adds migration `0018`. Rules: "Due dates" in [domain.md](domain.md).

## What the owner asked for

The owner's Amazon card is due on the 3rd and paid as it happens. A payment on Oct 13 sat
in the cycle after Oct 3, so it counted toward Nov 3 and the Oct 23 – Nov 5 period showed
no warning. It was really a late payment for Oct 3:

> It must have been a late payment that day. I'm probably going to need to be able to add
> that as an option in the transaction and then everything react to that flag.

## Decided (overrule any)

1. **A flag on the transaction**, `latePayment`, not a choice of which due date it pays. A
   payment marked late paid the last due date strictly before its date.
2. **It covers nothing.** It is skipped when looking for cover in its own cycle, so the
   next due date warns unless another payment covers it.
3. **The due date it was late for still warns** in its own period, naming the payment's
   date ("was due Oct 3, but its payment was dated Oct 13"). Marking it late agrees with
   that warning rather than silencing it.
4. **Only a transaction tied to an item can be marked.** Asking for it on an untied one is
   a field error on `latePayment` (create and patch); untying one clears it.
5. **The dialog offers it only for money out toward an item with a due date**, and not when
   splitting. The line under it names both dates ("It paid what was due Oct 3, so it
   doesn't count toward Nov 3"). Hidden, it is saved as not late.
6. **Shown as "Late payment"** in the period's rows and in a recurring item's transactions;
   the MCP transaction line says "late payment, for the due date before it".
7. **Nothing else reacts.** Balances, Advice, splits and imports ignore it: it changes
   which due date a payment counts toward, never an amount.

## What was built

- `transactions.late_payment` (boolean, default false): migration `0018`.
- `Transaction.latePayment` (optional, so a newer app tolerates an older server); create
  and patch take it; `LATE_NEEDS_ITEM_MESSAGE` in `src/shared/transactions.ts`.
- `uncoveredDue` takes `DuePayment`s (`{ date, late }`); `dueDatesAround` names the due
  dates either side of a day, for the dialog's line.
- Transaction dialog: the "Late payment" box under "Recurring item".
- MCP: `create_transaction` and `update_transaction` take `latePayment`.

## Checked

- `npm run check`: 1428 tests in 67 files, including new table rows for `uncoveredDue`
  and `dueDatesAround`, and four API tests (marking and unmarking moves the warning,
  marking on create, refused untied and cleared on untying, another user gets a 404).
- In the browser on the local `sample` account (bill and payment removed afterwards): an
  "as it happens" bill due on the 3rd with a paid Oct 13 payment showed no warning in
  Oct 23 – Nov 5; the dialog offered "Late payment" with "It paid what was due Oct 3, so it
  doesn't count toward Nov 3"; ticked and saved, the home screen warned "is due Nov 3, and
  nothing is set to pay it by then".

## Not checked

- The dialog on a phone width or in light mode; the Android app (not rebuilt); the MCP
  tools with a real assistant (the file was rebuilt).
