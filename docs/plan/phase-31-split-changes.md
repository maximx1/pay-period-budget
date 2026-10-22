# Phase 31: Splits kept, rounded up, added to and skipped

Asked for 2026-10-22, built the same day on `main` after [phase 27](phase-27-split.md);
not yet deployed. Adds migration `0016`.

## What the owner asked for

> In our split feature I think I want another checkbox for "round to next $50". So if the
> split calculates a $162.55 for a split value it would bump it to $200 for each
> transaction and would subtract the extra from the end. [...] if we rounded to $200 a few
> times and it got to the point that the rounding covered a whole payment, we could remove
> that last payment.

Then: a way to add to an existing split (a "pay in 6 months" plan two months in, and a new
purchase on the same plan), keeping something that ties a split's transactions together,
and skipping one payment with the ones after it worked out again ("a little short on funds
for one period"). On rounding, after the first proposal:

> I would like it to be the nearest $50 for the whole period's total because you could have
> maybe like three $12 payments [...] if you round every single individual one, you'd hit
> $150.

## How it works

- **The split is kept.** `splits` holds the name, type, note, links, "finish early",
  "round up" and the periods skipped; `split_items` each amount, due date and the date its
  payments began. Each transaction a split makes has `split_id` and `split_shares` (what
  each item makes up of it); so does each waiting payment (`shares`). The API's
  `Transaction` carries `splitId`.
- **Round up to the next $50** (`roundUp`, a checkbox under "Finish a pay period early").
  The even plan is worked out as before; then each period's payment is its total rounded up
  to a multiple of $50 (`SPLIT_ROUND_CENTS`). Each item first gets its even share (or what
  is left of it, if less) and the extra goes to the item due soonest, then the next. Nothing
  is paid past what is left, so the last payments shrink and drop off. $975.30 over six
  periods: four of $200 and $175.30. Three items of $12 a period: $50, $50, $44. No item is
  ever behind the even split, so each is still paid by its due date (`planSplit` in
  `src/shared/split.ts`; tested over several shapes).
- **Working it out again** (`rework` in `services/split.ts`), from a period on. Kept as they
  are, and counted for what they came to: paid payments, and any in earlier periods. A paid
  payment whose amount was changed by hand counts for its real amount: short, the item due
  last takes less; over, the item due soonest takes more (`fitShares`). What is left of each
  item is spread over the open periods from there to its due date: not skipped, and not
  holding a kept payment. Rounded up again if the split says so. A period's existing unpaid
  payment is changed in place (keeping its date, place and id); a new one goes through the
  import; one no longer needed is deleted; the starting amounts after each are carried.
  Waiting payments are dropped and made again from the new plan.
- **Adding to a split** ("Add to this split" in a split payment's edit dialog and on the
  Split payments page; `POST /api/splits/:id/items`). The new items (each named) start in
  the period of the first payment given (now, by default) and the split is worked out
  again from that period. An only item with no name takes the split's name, for the note.
  "Round up" can be turned on or off as it goes.
- **Skipping a payment** ("Skip this payment" in the edit dialog, "Skip" beside each on the
  Split payments page; `POST /api/splits/:id/skip`). The payment is deleted, its period
  remembered as skipped, and the split worked out again from the next period: the ones
  before it stay. A preview (a dry run) lists what the payments after it become. Refused:
  the last payment before an item is due ("That's the last payment before PayPal is due on
  Mar 5, 2026, so it can't be skipped"), and a paid one.
- **Split payments page** now lists every split with anything unpaid: what is left of each
  item, its unpaid payments with Skip, Add to this split, and what waits as before. The side
  panel shows it while any split has something unpaid.

## Decisions (overrule any)

- Rounding is always up, to $50, of each period's total. Not configurable yet.
- The rounding extra goes to the item due soonest, then the next.
- Working out again re-spreads what is left evenly to each item's due date, then rounds; it
  does not keep the old payment amounts and simply end sooner. With rounding on, that is
  usually the same thing.
- Deleting a split's transaction is not a skip: the money it held is simply not planned
  until the split is next worked out (an add or a skip), which then spreads it.
- Editing an unpaid split payment's amount by hand is not remembered: the next add or skip
  sets it back to the plan. A paid one is kept at what it came to.
- A paid payment holds its period: adding to a split in a period whose payment is paid
  starts the new item in the next period.
- Splits made before this phase only had a row made for those with payments waiting
  (migration `0016`), with no items: they still list and add what waits, but can't be added
  to or skipped. Transactions they made long ago aren't tied to anything.
- The client treats every new field as possibly missing (`splitId`, the list's `items`,
  `upcoming`, ...), since the phone app can be newer than the server.

## Verified

- `npm run check`: 1363 tests in 66 files. `src/shared/split.test.ts` (`planSplit`: the
  even plan, closed periods, items starting later, stranded items, rounding the owner's
  examples, never behind the even split; `fitShares`), `src/server/routes/splits.change.test.ts`
  (19: rounding through the API, the split tied and listed, skipping with carries and dry
  run, staying skipped, refusals, rounding after a skip, a hand-changed paid amount,
  waiting payments re-planned, another user's split, adding with paid payments kept and
  new notes, dates of new payments, turning rounding on, refusals, a split from before),
  `src/server/db/migrations.test.ts` (0016: legacy splits get a row; deleting a split
  unties its transactions; the foreign key's `ON DELETE`, which drizzle-kit left out again,
  added by hand).
- In a browser on the dev server, demo account (today 2026-10-22, biweekly): $975.30 due
  Jan 5 previewed six of $162.55, and with the box ticked 4 × $200 + $175.30 (five); saved.
  The edit dialog showed "Part of the split PayPal, $975.30 left in 5 payments, rounded up
  to $50"; the skip preview for Oct 22 moved it onto five payments ending with $175.30 on
  Dec 31. Adding Couch $300 due Mar 1 previewed and saved eight payments, the notes
  splitting each ("PayPal $170.00 + Couch $30.00"); skipping Nov 19 from the Split payments
  page re-planned to $250, $250, $250, $50, $50, $25.30 as worked out by hand. 360px dark:
  no horizontal overflow on the page or the add-to dialog.

## Not verified

- On the Android app: the debug build was installed on the owner's Pixel over Wi-Fi on
  2026-10-22 and opened, but not used there; it needs a server with this phase.
- Turning rounding off on a split that had it on, in the browser (API path covered for on).
- A split with a transfer or income, through the new actions (same code as expenses).
