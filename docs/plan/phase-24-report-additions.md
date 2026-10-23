# Phase 24: Reports: year to date, and where the money went

Asked for 2026-10-16.

## Year to date (on `main`, commit ca3feb0)

A span choice: January 1st of today's year through the end of the current pay period. A
report counts every period that shares a day with its dates, so a period that began in
December counts whole (the owner's call: some December days may show). Past every
period into a new year, it is just the latest period. `spanFor` in
`src/client/features/reports/derive.ts`, tested in `derive.test.ts`.

## Where the money went (cash-flow chart)

A Sankey diagram in "At a glance", modelled on a screenshot the owner supplied, as three
columns: money in by where it came from (each income, "Other income"), the total, then
"Kept" (income less spending) and money out by category. When more went out than came in,
"From leftover" joins the sources so both sides balance.

- `cashFlow()` in `reports/derive.ts` works out the nodes from the figures the page
  already has. Categories keep the colours the other category charts give them (seven
  plus Other, Uncategorised grey); the income side and Kept use the app's green.
- `components/charts/sankey.ts` is the layout (tested without a browser) and
  `SankeyChart.tsx` draws it in plain SVG. Every bar is labelled with its amount and share;
  small bars are spread apart so each label sits level with its own bar. On a phone the
  total is named above the chart. Pointing at a bar or band brings it forward. The Table
  button gives the same numbers.

## Decisions (overrule any)

- Three columns, not the screenshot's four: categories have no groups.
- It covers the span the page is set to (whole pay periods), not a calendar month.

## Changed 2026-10-23: started with and cash on hand

The owner: "From leftover" should not sit on the income side, as it is "technically a
part of the paycheck and all the other incomes", and the right side should end in "cash
on hand", the latest leftover, to help with "where do I go from here". Asked back, the
owner chose to keep both sides balanced this way:

- The sources are each income, then **"Started with"** (grey): the first period's starting
  amount. The total is "Income and what you started with".
- The uses are **"Cash on hand"** (green, first): the last period in the span's projected
  leftover, the figure the home screen shows for a current period. Then the categories.
  "Kept" and "From leftover" are gone: income less spending is only what moved the
  leftover from one to the other.
- Anything else that moved the leftover (a starting amount set by hand, a balance below
  zero, which counts as nothing on hand) is **"Adjustments"** (grey), on whichever side is
  short, so the two sides always balance.
- Checked on the demo account over its default span: $12,900.00 + $224.76 + $6,999.60
  in, $11,234.81 on hand (the "Leftover now" figure) and the categories out, with no
  Adjustments; at 375px nothing overflows.

## Not verified

- Hover highlighting, and 360px width (375px was checked by eye; 1280px measured: no
  label overlaps or overflow).
