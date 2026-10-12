# Phase 15: Transfers, where money goes out and comes back

**Goal:** one bill or income can stand for another account of the owner's own: a savings
account, the joint account, a HELOC or other loan. Money sent to it is money out of the
budget; money brought back is money in; and the item shows what has gone each way and the
balance that leaves.

**Depends on:** phase 13 (tying transactions to an item), phase 14 (the dialog and the
filter this adds to).

**Status:** planned 2026-10-12 from the owner's description and built the same day: every
task is done. Checked in a browser. **Not yet deployed**, the MCP side has not been used by
a real assistant, and the Android app has not been rebuilt with it. Adds migration `0009`.

This file was first written as "Savings". The owner corrected that the same day: it is any
bank account of his, "the joint account or the HELOC or loan", and asked for a single word
that covers them. See decision 1.

## What the owner asked for

> A bill and income can technically be one of my savings accounts. Like I might send money
> to my taxes account at random times. In those cases it's an expenditure. But when it
> comes time to pay taxes, those will be migrated back into my main account and sent out
> as a check. So when it comes from the savings back into the checking account that's
> basically an income for just that one instance.

Later the same day: "MCP will need to also have a way to transition these things too. I
already created some recurring accounts that are listed as bills but are really savings
accounts."

The case, in the app's terms:

| When | What happens at the bank | In the budget |
| --- | --- | --- |
| Now and then | $400 moves from checking to "Taxes" savings | Money out, tied to *Taxes savings* |
| Tax time | $1,500 moves from "Taxes" savings back to checking | Money in, tied to *Taxes savings* |
| Same day | A $1,500 check goes to the tax office | Money out. **Not** tied to *Taxes savings* |

The last two cancel in the period they happen in, which is right: the money was already
counted as spent when it was set aside.

## What was there before

- The API already let a transaction in either direction be tied to any item; only
  `countsToward` compared directions.
- The transaction dialog set Type back to the item's own kind whenever an item was chosen,
  so the order the form was filled in mattered.
- The detail view added both directions into one "Paid" figure: $1,500 sent and $1,500
  brought back read "Paid $0.00".
- An item had to be filed as a Bill or as an Income.

## The two questions, as answered by the owner (2026-10-12)

1. **A third type of bill or income, not the start of the Accounts feature.** Accepted as
   suggested.
2. **It shows what is in it, and can be told what was there already.** Accepted as
   suggested, and widened by the correction above: for a loan what is "there" is owed, so
   the figure is a signed **balance** and the starting amount may be negative.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **On screen it is "Transfer"; in the code the kind is `"transfer"`.** It is the usual
   word for money moved between your own accounts, it fits a savings account and a loan
   alike, and it is not "account", which stays reserved (see `CLAUDE.md`). **"Account" was
   the other candidate** and is the more natural name for the thing itself ("HELOC:
   Account"); choosing it means lifting that reservation, which is the owner's call. The
   on-screen word lives in two places (`KIND_LABELS` in `ItemTransactions.tsx`,
   `kindOptions` in `BillOrIncomeDialog.tsx`) plus the filter's "Transfers".
2. **A transfer's own direction is money out.** With a schedule ("$200 to Taxes every pay
   period") it adds upcoming money-out entries, exactly as a bill does. Bringing money
   back is always entered by hand, or imported.
3. **Balance = starting balance + paid money out − paid money in.** Upcoming entries do
   not count. Below zero it reads "$9,400.00 owed". It is worked out from the transactions
   tied to the item and never reconciled: interest is not in it unless it is entered.
4. **Bills and incomes keep accepting either direction too**, as before: a refund tied to
   a bill rightly lowers what has been paid. Only a transfer gets the two-sided figures.
5. **Money brought back is ordinary income in its period.** Nothing in the period totals
   or the carry-forward knows about transfers.
6. **What the money is then spent on is not the transfer's business.** The check to the
   tax office is its own transaction. Tied to the transfer it would count as money sent.
   The transaction dialog says which way each one counts.
7. **A bill becomes a transfer by editing its type**, on screen or with
   `update_bill_or_income`. Nothing that exists is touched; its balance appears at once.
8. **No transfers between two items**, and no linked pairs. One transaction, one item.

## Tasks

### 15.1 The kind, the starting balance and the two-sided totals (shared and server)

- [x] Done

- `BILL_OR_INCOME_KINDS = ["expense", "income", "transfer"]` and `entryKindOf` in
  `src/shared/billsIncome.ts`. `TransactionKind` is unchanged.
- `openingCents` on the item: signed, default 0, non-zero only for a transfer.
- `totals` on `GET /api/bills-income/:id/transactions` gains `paidOutCents`,
  `paidInCents` and `balanceCents`.

### 15.2 Entering money that goes to it, or comes back

- [x] Done

### 15.3 The item on the Bills & Income page

- [x] Done

### 15.4 The assistant and the import

- [x] Done

### 15.5 The starting balance

- [x] Done (folded into 15.1 and 15.3)

## Implementation notes

### All tasks (2026-10-12)

**Server**

- `bills_income.opening_cents`, integer, not null, default 0: migration
  `0009_bill_income_opening.sql`, as `db:generate` wrote it, one `ALTER TABLE … ADD`.
  `migrations.test.ts` runs it over a filled database. The `kind` column is plain text
  and needed nothing.
- Only `services/materialize.ts` read an item's kind as a direction; it now asks
  `entryKindOf`. Generation, back-fill and the preview all go through it.
- `sumForBillOrIncome` returns the paid total by direction as well, in the same query.
  The service adds `balanceCents` for a transfer and null otherwise.
- An edit is checked after merging, like the amount rule: a transfer holding a starting
  balance cannot become a bill unless the same change sets `openingCents` to 0.
- `MAX_OPENING_CENTS` is $10,000,000 either side of zero, well above the $1,000,000 limit
  on one transaction: a mortgage is a balance, not a payment.
- `routes/billsIncome.transfer.test.ts`, 12 tests. The owner's three-row case is the
  first; converting a scheduled bill into a transfer is another (same transactions, same
  starting amounts, balance at once, schedule still adding money out); a HELOC held as a
  negative balance; another user's transfer is the same 404 as one that does not exist.
- The older tests that pinned the totals' exact shape were given the new fields. One of
  them used `"transfer"` as its example of an unknown kind; it now uses `"gift"`.
- Checked by breaking three rules once each: a transfer's entries generated as income (3
  tests fail), the two directions swapped (6), any item allowed a starting balance (2).

**Bills & Income page**

- The dialog's Type is **Bill / Income / Transfer** on a row of its own, with a line under
  it for a transfer saying what one is. A transfer also gets **Starting balance
  (optional)**, which takes a minus for money owed. The title when editing is "Edit
  transfer".
- The kind filter is **All / Bills / Income / Transfers**, using `fitLabels` so the four
  fit at 360px (273px wide).
- The card says "Transfer · " before the schedule. Its usual amount shows as money out.
- The detail dialog and the all-transactions page show, for a transfer: **Balance** on a
  row of its own, then **Sent**, **Brought back**, **Upcoming** and **Transactions**. With
  three across, "$2,475.00 owed" was cut off.
- **Fixed on the way:** an item with nothing upcoming showed "Upcoming -$0.00" in those
  figures (a negated zero), and had since 13.7.
- With Type on its own row, "Usual amount (optional)" no longer wraps beside it at 360px
  (noted in phase 14).

**Transaction dialog**

- Choosing a transfer never changes Type: it goes either way, and the form's own default
  is already Expense. Choosing a bill or an income still sets Type to match.
- While a transfer is chosen, the line under the list reads "Money going to Taxes
  savings." or "Money coming back from Taxes savings.", following Type.

**Assistant and import**

- `create_bill_or_income` and `update_bill_or_income` take `kind: "transfer"` and
  `openingCents`, and describe both. The update tool's description says how to turn a bill
  into a transfer. `list_bill_or_income_transactions` adds a line for a transfer: sent,
  brought back, balance. An item's line shows its starting balance.
- A test does the owner's conversion through the tools: a bill with money tied to it
  becomes a transfer, money comes back, the balance is reported, and going back to a bill
  is refused until the starting balance is given up.
- **The import needed no change.** A test shows why: money coming back for the same
  amount as an upcoming money-out entry is not offered `countsToward` (the signed amounts
  differ, so it is not a possible duplicate); and once each direction's bank wording has
  been tied once, both are suggested for the transfer from then on. **The first time money
  comes back, nothing is suggested** unless the bank's wording names the item: "TRANSFER
  FROM SAV" is a different description from "TRANSFER TO SAV".
- `README.md` has a paragraph on transfers in the import steps.
- **`npm run build:mcp` was not run.** The built file in `dist/` is whatever it was; an
  assistant needs it rebuilt to know the new kind.

**Checked in the browser** on the dev account, 1280px light and 360px dark, with a
temporary transfer: added as it happens with a starting balance of -2500; $40 sent and $15
brought back gave "Balance $2,475.00 owed", "Sent $40.00", "Brought back $15.00"; in the
transaction dialog, Type set to Income first and the transfer chosen second stayed Income,
and the line followed Type both ways; reopened for editing it read "Edit transfer" with
-2500.00. The item and both transactions were deleted afterwards and the period's totals
compared equal to before.

**Not checked:** a scheduled transfer in the browser (covered by the API tests); the
all-transactions page for a transfer (it uses the same `ItemTotals`); turning an existing
bill into a transfer from the dialog (covered through the API and the MCP tools); anything
on Android.

**While this was being built the dev server's Bills & Income page returned an error for a
few minutes.** `tsx watch` restarted on the schema change before the migration file
existed, and does not restart for a new `.sql` file. Touching a server file restarted it
and the migration applied. On a deployed server the migration runs at start-up as usual.

### The home card: Income and Expenses (2026-10-12, asked for in passing)

The owner saw "Paid -$50.94" in the summary card and could not tell where it came from.
It was correct and unhelpful: the net of everything marked paid, deposits less payments.

- The card now shows **Starting, Income, Expenses, Upcoming**. Income is every positive
  transaction in the period and Expenses every negative one, paid or not, each as a
  positive amount, so Starting + Income − Expenses is the projected figure.
- They are added up in `PeriodSummary.tsx` from the period's transactions; the API's
  totals are unchanged, and `paidCents` still heads the Paid section.
- **A choice to confirm:** "in the period" was taken to mean paid and upcoming together.
  If Income and Expenses should count only what is paid, they would instead add up to
  "leftover so far"; it is a one-line filter either way.
- Checked on the dev account's current period: $3,840.08 + $2,746.81 − $184.78 =
  $6,402.11, the projected figure shown.
