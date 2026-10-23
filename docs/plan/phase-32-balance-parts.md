# Phase 32: A balance in parts

Asked for 2026-10-22 and built the same day on `main`, after [phase 28](phase-28-balances.md);
not yet deployed. Adds migration `0017`. Rules: "Balances in parts" in [domain.md](domain.md).

## What the owner asked for

> My student loan is broken up into multiple sub accounts with their own balance and
> interests.. but overall they are still just one payment.. Can we add that ability to the
> balance page?

Asked back, the owner chose:

- Between checks, a payment is **shared out by balance**: each part gets the share of it
  that its balance was of the whole at the last check.
- A check gives **every part each time**, with its balance and APR; the total is their sum.
- Advice treats **each part as its own debt**, so it can say "put extra toward part 3".
- On screen they are **"parts"**. ("Accounts" stays reserved; see `backlog.md`.)

## Decided

1. **Parts belong to checks.** A check either has parts or not. A check with parts has a
   row per part in `balance_check_parts`: the part's id (kept from check to check), its
   name, position, balance and APR. The latest check's parts are the balance's parts now: a
   part left out of a check is gone from then on, and one with a new name is added.
2. **The check row keeps the whole.** On a check with parts, `balance_checks.balance_cents`
   is the parts added up and `apr_bps` their balance-weighted rate (null when none has a
   rate), so the estimate, the chart, the totals and everything that reads a check work as
   before. The service keeps them in step when a part's rate changes.
3. **The estimate in parts.** The whole is estimated as before (phase 28). What it moved
   since the last check is shared over the parts in proportion to their balances at that
   check, rounded so the parts add up to the whole (`shareOverParts` in
   `src/shared/balances.ts`). All at zero: evenly. A payment toward one part in particular
   is still shared out; the next check puts it right.
4. **Interest a month** with parts is each part's at its own rate, added up; null when no
   part has a rate.
5. **Checks with parts** (`POST .../checks`, and tracking): `parts: [{ id?, name,
   balanceCents, aprBps? }]`, 1 to 20, names unique, all on the same side of zero. With parts
   the total and the APR are left out. A part's APR left out keeps its last rate. An `id`
   must be one of the balance's parts, in any earlier check. A balance whose last check has
   parts refuses a check without them, so nothing drops them by mistake; `parts: []` with a
   `balanceCents` stops splitting it. "Looks right" records every part at its estimate.
6. **Changing a part in place**: `PATCH /api/balances/:billIncomeId/parts/:partId { name?,
   aprBps? }` changes the latest check's part, as phase 28's rate change does for the whole.
   The whole's `aprBps` patch is refused on a balance in parts ("Change each part's rate").
7. **Advice**: each part of a tracked balance is a debt (or a saving) of its own, named
   "Student loan: 1-01", with `partId` set. Its usual payment is the bill's, shared by its
   share of the balance. A plan's payment to a part is a transaction tied to the bill, with
   the part in its name.
8. **MCP**: `list_balances` lists the parts; `record_balance_check` takes `parts`.

## Tasks

- [x] 32.1 Schema, repo, `shareOverParts`, the estimate and interest in parts
- [x] 32.2 API: checks, tracking and Looks right with parts; changing a part; tests
- [x] 32.3 The forms: "Split into parts" and a row per part in Add a check, the check rows
  and Track a balance
- [x] 32.4 The history dialog: the parts with their estimates, rates and a pencil each
- [x] 32.5 Advice and MCP

## Implementation notes (2026-10-22)

- **Server**: `balance_check_parts` (migration `0017`, a new table only: the generated SQL
  was read and kept). `BalanceRepo` gained `addCheckParts`, `listCheckParts` and
  `updateCheckPart`. In `services/balances.ts`, `checkOf` turns a check's input into its
  balance, rate and parts (and refuses what decision 5 refuses); `estimateFor` shares the
  estimate over the last check's parts; `updatePart` is the new `PATCH .../parts/:partId`.
- **Shared**: `shareOverParts`, `blendedAprBps` and `partsInterestCents` in
  `src/shared/balances.ts`, with table-driven tests; `BalanceCheck.parts` and
  `TrackedBalance.parts` in the API.
- **Forms** (`BalanceFields`): "Split into parts" under the single balance turns it into two
  parts, the figure and rate typed so far going to the first. Each part has a name, a
  balance and an APR, with a remove button; "Add a part" and the total sit below. Removing
  the last part makes its figure the balance again, and saving that ends the parts. The
  check forms start with every part's name and rate and empty amounts, and follow a part's
  name and rate when changed in place (`useFollowRates`). In Track a balance, Add a check
  and each "Due for a check" row.
- **History dialog**: "APR, blended" (no pencil) over a list of parts, each with its
  estimate, rate, interest a month and a pencil for its name and rate. The checks list says
  "· 2 parts"; so does the line on each balance's card.
- **Advice**: `Debt`, `Saving`, `PlanLine` and the plan items carry `partId`; plans key by
  `planKey`. A quick-added payment to a part is a transaction tied to the bill, named after
  the part ("Student loan: 1-02").
- **MCP**: `record_balance_check` takes `parts`; `list_balances` puts each part on a line of
  its own with its id. `npm run build:mcp` was run.

**Checked in the browser** on the dev account (`sample`) at 1024px and 360px: Xterra
Payment split from one figure into 1-01 ($7,000 at 6.8%) and 1-02 ($5,000 at 4.5%) through
Add a check: 5.84% blended, $58.42 interest a month, the form back with both parts and empty
amounts. 1-02's pencil to 5%: 6.05% blended, $60.50, the form's rate following. A new
"Student loan" tracked in two parts from Track a balance at 360px, the same name twice
refused on the second part. On the Advice page, Fewest payments cleared "Student loan:
1-02" and put the rest toward "Xterra Payment: 1-02".

**Not checked:** dark mode (semantic colours only); the home card's check row with parts
(the same fields as Add a check); a quick add of a part's payment; a payment moving the
parts in the browser (the API tests cover the sharing); Android.
