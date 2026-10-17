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

## Not verified

- Hover highlighting, and 360px width (375px was checked by eye; 1280px measured: no
  label overlaps or overflow).
