# Phase 20: Reports

**Goal:** a Reports page that shows, for a span of pay periods, where the money came from
and where it went: by bill, by category, over time and as shares.

**Depends on:** phase 13 (bills tied to transactions), phase 18 (categories and limits),
phase 19 (the search it links to).

**Status:** asked for by the owner on 2026-10-13 and built the same night, unattended, on
his instruction to "make assumptions; we can back stuff out tomorrow". Twenty-five reports
on one page. Checked in a browser on the demo account. **Not yet deployed**, the MCP side
has not been used by a real assistant, and nothing has run on Android.

## What the owner asked for

> Then I would like to get some reports. First one I can think of is something like see see
> a chart of recurring payments and how much I spent per period for a span of time. Then
> one by category.
>
> I would like a pie chart of where my money went in a period or in a span of time.
>
> Come up with other common ones. Limit yourself to maybe 30 if it needs that many.

He also allowed two helpers to suggest reports for ten minutes. Two were asked, one for
what budgeting and banking apps commonly show and one for what someone budgeting paycheck
to paycheck wants to learn. Their lists and the choice are under "How the list was chosen".

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **A report covers whole pay periods.** A span of dates means every pay period that
   shares a day with it. Choosing "Last 6 pay periods" means the current one and the five
   before it; "Everything so far" stops at the current one.
2. **Paid and upcoming both count**, as on the home card and for limits.
3. **"Spent" in these charts is money out, not out less in.** A refund does not shrink a
   category's slice. (A limit still counts a refund against spending; the limit reports
   use the limit's own figure.) Netting would have made "Uncategorised" vanish wherever a
   paycheck is uncategorised.
4. **Transfers count as money out and money in**, like everything else, and also have a
   report of their own. **Changed 2026-10-14** at the owner's request: within one pay
   period each transfer counts once, as the difference between what was sent to it and
   what came back ($300 sent and $100 back is $200 sent), under the transfer's own
   category. `netTransfers` in `shared/flows.ts` does it for the reports and for the home
   card's Income, Expenses and bars alike. The transactions are untouched, and so are the
   limits, the spending pace, names and largest payments, which go transaction by
   transaction. "Committed and everything else" and "Shares of income" now show Bills and
   Transfers apart.
5. **Colour follows the thing.** The seven categories (or bills) with the most money in the
   span each get a colour, largest first; the rest are "Other"; "Uncategorised" and "Not
   tied to a bill" are grey. The same category is the same colour in every chart on the
   page. The order of the eight colours is fixed and must not be shuffled: it is what keeps
   neighbours apart for colour-blind readers.
6. **Every chart can be read as a table** ("Table" on its card), and pointing at a column
   reads out every series there. Nothing depends on telling colours apart.
7. **No chart library.** The charts are about 400 lines of SVG in `components/charts/`.
   `CLAUDE.md` says to ask before adding a dependency, and there was nobody to ask.
8. **No calendar-month report.** Months cut across pay periods and would disagree with
   every other number on the page.
9. **"Projected against actual leftover" was not built.** The app does not keep what a
   period was projected to end with before it ended, so there is nothing to compare.
10. **Names stand in for shops.** "Kroger" and "KROGER" are one name; "KROGER #512" is
    another. The search (phase 19) is the way to add them together.
11. **A demo account for looking at all this**: `npm run db:seed-demo` makes a second
    local account, "demo", with nineteen pay periods of made-up data; its password is in
    `src/server/scripts/seedDemo.ts`. `npm run db:seed-demo -- --remove` deletes it. It was
    run on the dev database, so **the dev database now has a "demo" account** beside the
    owner's own, which was not touched.

## The reports

**At a glance**

1. The span in figures: income, expenses, kept or overspent, leftover now, counts.
2. Not filed under a category: how much, its share, and a button that searches for them.

**Pay period by pay period**

3. Income and expenses (columns side by side).
4. What each paycheck left: income less expenses, below the line when overspent.
5. Leftover over time (line).
6. Bills and transfers: money out by bill, stacked. *The owner's first.*
7. One bill or income over time, with its total, its average and what it costs a year.
8. Spending by category, stacked. *The owner's second.*
9. One category over time, against each period's limit.
10. Committed and everything else: tied to a bill or not.
11. Shares of income: the part that went to bills, and the part left over (lines).
12. Transfers: sent and brought back. Shown when there is a transfer.
13. Spending pace: this period day by day against the average of the ones before.

**Where it went**

14. By category (ring). *The owner's third.*
15. By bill (ring).
16. Where income came from (ring).
17. Names most was spent under (ranked bars).
18. Largest one-off payments (table), not counting what a schedule added.
19. Days of the week (columns).

**Limits**

20. Spending against limits: each category's spending against its limits added up.
21. Kept or gone over: every limit in every period, what was left or how far over.
22. This pay period against your usual: by category, largest differences first.

**Bills and what is coming**

23. What each bill costs a year, by its schedule, beside what it came to in the span.
24. The next six pay periods: scheduled income and bills.
25. Not yet marked paid: dated before today and still upcoming.

## How the list was chosen

Both helpers put income against expenses, leftover over time, committed against flexible
spending, limits kept or broken, spending pace, largest transactions, top names, and
transfers in their lists; those are all here. One put a calendar-month view in and the
other argued against it; it is out (decision 8). Both wanted projected against actual
leftover; see decision 9. Also suggested and not built: this period against the previous
one alone (22 does it against the average, which one odd period distorts less), a
day-of-period heat map (19 is the simple form of it), and bill price changes as a table of
their own (7 shows them as a step).

## What was built

- `GET /api/reports?from=&to=` → `Report` (`src/shared/reports.ts`): one answer that every
  chart on the page is drawn from. Each period's totals and its split by category and by
  bill; the span's top names, largest one-off payments, days of the week, spending pace
  and unpaid entries; and what the schedules bring in the next six periods. It reads only
  and creates no period.
- `services/reports.ts` builds it from one query for the span's transactions.
  `categoryLimits.listForUser` is the one new repo method.
- `components/charts/`: `XYChart` (columns, stacked or side by side, and lines, on one
  scale), `DonutChart`, `BarList`, `DataTable`, `Legend`, `palette.ts`. They are shown on
  `/dev/ui`. `styles.css` has `--chart-1` to `--chart-8` and `--chart-neutral` in all
  three theme blocks, checked for colour-blind separation on the app's light and dark card
  colours.
- `features/reports/`: `ReportsPage.tsx`, `derive.ts` (which periods a choice of span
  means; which colour each thing gets) and `api.ts`. "Reports" is in the side panel.
- MCP: `get_report`, the same answer in words. Twenty-two tools in all with
  `search_transactions`.
- Tests: `routes/reports.test.ts` (8, the figures worked out by hand first, and one that a
  report is only ever about the asker's own budget), `features/reports/derive.test.ts`
  (14), one in `mcp/tools.test.ts`. 933 in all; `npm run check`, `npm run build` and
  `npm run build:mcp` are clean.
- Checked by breaking five rules once each (periods chosen by overlap, limits read, names
  joined whatever their capitals, the pace stopping at today, a period not yet created
  starting the day after the last): each fails a test.

**Checked in the browser** on the demo account at 1280px light and 375px dark, six pay
periods: all twenty-five cards drew; nothing was wider than the screen; the rings' lists
added up to their totals; pointing at a column read out both series and dimmed the others;
a limit that was passed showed in the warning colour.

**Not checked**

- "Last 3", "Last 12", "Last 26" and two typed dates on screen. The choice of periods is
  unit-tested. ("Everything so far", nineteen periods, was looked at on a phone: the
  labels along the bottom thinned to every fifth, and the "Table" view scrolled sideways
  inside its card without widening the page.)
- The "Table" view of the other cards, and the selects on reports 7 and 9, by hand.
- A span with a single pay period, and an account with almost no data, such as the
  owner's own: most cards will be thin there.
- The tools with a real assistant. Anything on Android.
- No component tests exist in this project, so none were added for the charts.
