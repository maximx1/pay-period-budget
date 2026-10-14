# Phase 18: Categories and spending limits

**Goal:** a transaction can be filed under a category ("Groceries"). A category can have a
limit for each pay period, and the home screen says so when a period's spending in it goes
over. Bills and income can carry a category that their entries inherit. All of it is
reachable by an assistant through the MCP server.

**Depends on:** phase 5 (generation, which limits copy), phase 6 (the period settings
dialog), phase 11 (import, MCP), phase 13 (tying transactions to a bill or income).

**Status:** planned 2026-10-13 from the owner's description; the owner answered the three
questions below the same day, each as suggested, and it was built the same day: every task
is done. Checked in a browser on the dev account. **Not yet deployed**, the MCP side has
not been used by a real assistant, and the Android app has not been rebuilt with it. Adds
migration `0010`.

## What the owner asked for

> I want to be able to register stuff under a label. So maybe we need a label's view in the
> side bar and a way to associate a transaction with them.
>
> The idea of the categories is to be able to do something like say I only want to spend
> $200 on groceries and it pop up as an alert on the period's screen if you go over the
> budget cap for that. It's also something we'll end up throwing in reports as well down
> the road.
>
> I envision the limits to work similar to the recurring transactions where there's a
> default value. Each period gets it's own instance of it, when you create one you can
> optionally add it to the current and future existing, but it won't apply automatically
> to the past ones. However if you choose you can add them via mcp or via the ui in the
> period options.
>
> And how they work is that it just adds up everything with a category in the period and
> if it reaches the limit then it has a little warning message at the top saying "you went
> over your budget for xxxx by $yyy.zz this period"
>
> And the category can be applied to each transaction individually. If you add it to a
> recurring all the future generated recurring get the label automatically applied. If,
> when adding to the recurring, there should be a checkbox to apply to all transactions of
> a type.
>
> If I didn't say I want this all working with mcp too.

## What is already there

- Nothing about categories. `backlog.md` had one line: "Categories or tags, and filtering
  by them."
- The pattern the limits copy: a bill or income holds a usual amount, each period gets its
  own entry when it is generated (`onPeriodCreated` in `services/periods.ts`, which calls
  `materializeAllInPeriod`), and creating one adds to the periods that already exist
  (`create` in `services/billsIncome.ts`).
- `onPeriodCreated` runs for a period generated forwards and for one added before the
  earliest (`addEarlierIn`) alike. Limits need to tell the two apart.
- `buildView` in `services/periods.ts` already loads every transaction of the period, so
  adding up a category costs no extra query.
- The period settings dialog (`PeriodSettingsDialog.tsx`) holds dates and the starting
  amount. It is what the owner calls "the period options".
- `Alert` is the only message primitive and it is the error style. `styles.css` has a
  `warning` colour but no warning background.
- The transaction dialog and the bill or income dialog each have a pattern for an
  optional list ("Bill or income": None, then the items by name).

## Questions for the owner (all three answered 2026-10-13: as suggested)

The owner's words: "only 1"; "yeah you'd have to replace all of the categories on all the
transactions for the bill or income"; "upcoming counts yes."

**1. One category per transaction, or several?**

The request says both "label" and "category".

Suggested: **one.** A limit adds up "everything with a category in the period"; if a
transaction could carry two, its money would count against both and the categories would
no longer add up to what was spent, which matters again when reports arrive. One is also a
single list in the dialog rather than a multi-select. Going from one to several later is a
migration that loses nothing; going from several back to one is not.

**2. "A checkbox to apply to all transactions of a type": which transactions?**

Suggested reading: **every transaction already tied to that bill or income.** When a
category is put on the rent, the entries it adds from then on get it by themselves, and
the checkbox reaches back over the ones that already exist. It sets them all, including
any that had been given a different category by hand; the checkbox says so.

The other reading would be every transaction of the same kind (all expenses), which seems
too wide to be meant.

**3. Do upcoming transactions count toward a limit?**

Suggested: **yes, with the wording saying which it is.** Everything in the period with the
category counts, paid or not, the same way Income and Expenses on the home card count the
whole period (confirmed by the owner 2026-10-12). That makes the warning useful before the
money has gone:

| Groceries, limit $200.00 | Spent | Message |
| --- | --- | --- |
| Paid $120.00 | $120.00 | none |
| and $95.00 upcoming | $215.00 | "You're set to go over your budget for Groceries by $15.00 this period." |
| the $95.00 is marked paid | $215.00 | "You went over your budget for Groceries by $15.00 this period." |
| and a $20.00 refund, filed under Groceries | $195.00 | none |

The alternative is to count paid transactions only, so the message never appears until the
money is spent.

## Decided

Applied as sensible defaults; say so to overrule any of them.

**Names**

1. **"Category" on screen and in the code.** The page is "Categories"; the table is
   `categories`, one of them a `Category`, the API `/api/categories`, the folder
   `features/categories`, and a transaction or a bill or income points at one with
   `categoryId`. "Label" is not used anywhere.
2. **The cap is a "limit".** A category's own figure is its *usual limit*
   (`defaultLimitCents`); a period's copy is a *limit* (`period_category_limits`,
   `CategoryLimit`). The owner's message keeps its own word, "budget".
3. **A category is a name and, optionally, a usual limit.** No colour, no icon, no
   expense-or-income kind. Names are unique per user without regard to case.

**Counting**

4. **Spent** in a category for a period is money out less money in, over every transaction
   in the period filed under it, and never less than zero. A refund filed under Groceries
   lowers what was spent on groceries. Transactions with no category count toward nothing.
5. **Over means more than the limit.** Spending exactly $200.00 against $200.00 says
   nothing. (The owner wrote "if it reaches the limit", and also "went over ... by
   $yyy.zz"; at exactly the limit that amount would be $0.00.)
6. **Limits are bookkeeping only.** Setting, changing or removing one moves no money and no
   starting amount. Neither does filing a transaction under a category.
7. **A limit belongs to its period, spending follows the dates.** Moving a period's
   boundary leaves its limits where they are; the transactions on the days that changed
   hands are counted in whichever period now covers them, as everywhere else.

**How limits come and go**

8. **A period generated forwards gets a limit for every category that has a usual one**,
   at that amount. Like an entry from a bill, it is a copy made once.
9. **A period added before the earliest gets none.** That is history; limits there are
   added by hand.
10. **Creating a category with a usual limit offers "Add it to the current pay period and
    the ones after it"**, ticked to begin with. Periods that have ended are never touched.
11. **Changing the usual limit later offers the same checkbox.** Ticked, the current
    period and every later one that exists are set to the new amount, replacing what they
    had, including one changed by hand; taking the usual limit away removes them.
    Unticked, only periods generated from then on differ.
12. **Any period's limit can be added, changed or removed in Period settings**, including
    a period that is over and one from before the budget began. Adding one starts from the
    category's usual limit.
13. **Deleting a category** leaves its transactions and its bills and income in place with
    no category, and removes its limits from every period.

**Bills and income**

14. **A bill or income may have a category.** Every entry it adds from then on is filed
    under it. As with any edit to one, nothing that exists changes unless the checkbox
    from question 2 is ticked.
15. **A transaction tied to a bill or income by hand takes its category unless told
    otherwise.** In the dialog, choosing the item fills in the category when none is
    chosen. In the API and the import, a row with `billIncomeId` and no `categoryId` takes
    the item's; `categoryId: null` says "none". A payment that counts toward an upcoming
    entry takes that entry's category.
16. **Changing which item a transaction is tied to afterwards does not change its
    category.**

## Not in this phase

- A page of one category's transactions, filtering or searching by category, and reports.
  The data they need is all here.
- The import suggesting a category for a row, the way it suggests a bill or income. An
  assistant can already put `categoryId` on rows itself.
- Showing limits that have *not* been passed on the home screen ("$120.00 of $200.00").
  They are shown on the Categories page and in Period settings.
- Adding every usual limit to an old period with one button. The assistant can do it in a
  loop; by hand it is one at a time.
- Limits over anything but a pay period (a month, a year), and several categories on one
  transaction.

## Shape

```
categories               id, user_id → users, name, default_limit_cents (null = none),
                         created_at, updated_at
                         unique (user_id, name) without regard to case
period_category_limits   period_id → periods, category_id → categories, user_id → users,
                         limit_cents, created_at, updated_at
                         primary key (period_id, category_id); all three cascade
transactions             + category_id → categories (set null)
bills_income             + category_id → categories (set null)
```

```
GET    /api/categories                     → { categories }, by name
POST   /api/categories                     { name, defaultLimitCents?, applyToPeriods? }
PATCH  /api/categories/:id                 { name?, defaultLimitCents? (null removes), applyToPeriods? }
DELETE /api/categories/:id
PUT    /api/periods/:id/limits/:categoryId { limitCents } → PeriodView
DELETE /api/periods/:id/limits/:categoryId → PeriodView
POST, PATCH /api/transactions, and import rows:  + categoryId (null clears)
POST, PATCH /api/bills-income:                   + categoryId, applyToTransactions?
```

`Transaction` and `BillOrIncome` gain `categoryId`. `PeriodView` gains:

```ts
categoryLimits: Array<{
  categoryId: string;
  name: string;
  limitCents: number;
  /** Paid and upcoming, money out less money in, never below zero. */
  spentCents: number;
  /** The same over paid transactions only: tells "went over" from "set to go over". */
  paidSpentCents: number;
}>   // by name
```

A limit is in cents, zero or more ($0.00 means "spend nothing"), up to
`MAX_TRANSACTION_CENTS`. A `categoryId` must name one of the caller's own categories; an
unknown one and someone else's are refused in the same words, as `billIncomeId` is.

## Tasks

### 18.1 Categories, and filing a transaction under one (shared and server)

- [x] Done

- **The whole phase's schema in one migration**, `0010`: the two new tables and the two
  new columns. Later tasks then add no migration. **Read the SQL.** Each new column must
  come out as `ALTER TABLE … ADD … REFERENCES categories(id) ON DELETE SET NULL`.
  `drizzle-kit` has dropped `ON DELETE` before, and has rebuilt a table by copy, drop and
  rename, which with foreign keys on would clear every transaction's link to its bill or
  income. If it does either, write the statement by hand (see `0008`).
- `src/shared/categories.ts`: input and patch schemas, `Category`, the responses.
  `defaultLimitCents` and `applyToPeriods` are accepted from the start but a limit does
  nothing until 18.4.
- `CategoryRepo` in `repos/types.ts` and `repos/sqlite/categories.ts`; a category
  service; `routes/categories.ts`, mounted in `app.ts`.
- `categoryId` on `transactionInputSchema` (so import rows have it) and
  `transactionPatchSchema`; on `TransactionRecord`, `Transaction` and the mapper.

**Files:** `src/shared/categories.ts` (new), `src/shared/transactions.ts`,
`src/server/db/schema.ts`, the migration, `src/server/db/migrations.test.ts`,
`src/server/repos/types.ts`, `src/server/repos/sqlite/` (`categories.ts` new, `index.ts`,
`transactions.ts`), `src/server/services/` (`categories.ts` new, `transactions.ts`,
`import.ts`, `transactionMapper.ts`), `src/server/routes/categories.ts` (new),
`src/server/app.ts`.

**Tests:** create, rename, list, delete; a second "groceries" is a field error on `name`;
another user's category is a 404 on every route. A transaction is filed on create, on
patch and on import, and unfiled with null; another user's category id is refused like one
that does not exist; filing changes no starting amount; deleting a category leaves its
transactions with none. The migration runs over a filled database with every link intact.

### 18.2 The Categories page, and choosing one for a transaction

- [x] Done

- "Categories" in the side panel between Bills & Income and Settings, at `/categories`,
  loaded on first visit. A list of cards by name; the + button and a card both open the
  dialog (name only for now); delete from the dialog, with a line saying what stays.
- The transaction dialog gains "Category": None, then the categories by name. Not shown
  when there are none.
- A transaction's row on the home screen shows its category in the muted line under the
  name, before the time and the note.
- Anything that changes a category refreshes the period on screen.

**Files:** `src/client/features/categories/` (new: `CategoriesPage.tsx`,
`CategoryDialog.tsx`, `api.ts`), `src/client/router.tsx`,
`src/client/features/shell/navItems.ts`,
`src/client/features/transactions/` (`TransactionDialog.tsx`, `TransactionRow.tsx`,
`api.ts`).

### 18.3 A category on a bill or income

- [x] Done

- `categoryId` on the bill or income schemas, record and response. `materializeInPeriod`
  files each entry under it.
- `applyToTransactions` on create and patch: also sets the category (or none) on every
  transaction tied to the item. The response says how many changed.
- Decision 15 on the server: in the link planner (`services/billIncomeLinks.ts`), a new
  transaction or import row with no `categoryId` takes the entry's or the item's.
- The bill or income dialog gains "Category". When editing and the choice differs from
  what is saved: a checkbox, "Also set it on the transactions already tied to this,
  replacing any category they have".
- In the transaction dialog, choosing a bill or income fills in its category when none is
  chosen, as it does the name and the amount.

**Files:** `src/shared/billsIncome.ts`, `src/server/repos/` (`types.ts`,
`sqlite/billsIncome.ts`, `sqlite/transactions.ts`), `src/server/services/`
(`billsIncome.ts`, `materialize.ts`, `billIncomeLinks.ts`),
`src/client/features/billsIncome/BillOrIncomeDialog.tsx`,
`src/client/features/transactions/TransactionDialog.tsx`.

**Tests:** entries generated after the category is set carry it, in a new period and in
back-fill; setting it without the checkbox changes nothing that exists; with it, every
tied transaction changes, generated or tied by hand, and nobody else's; a transaction tied
by hand takes the item's category, keeps its own when it names one, and has none when it
sends null; a payment toward an entry takes the entry's.

### 18.4 Limits (shared and server)

- [x] Done

- `onPeriodCreated` learns which way the period was added. Forwards: one limit per
  category with a usual one (decision 8). Before the earliest: none (decision 9).
- Creating a category, or changing its usual limit, with `applyToPeriods`: decisions 10
  and 11. "Current and later" is every existing period whose end is today or after.
- `PUT` and `DELETE /api/periods/:id/limits/:categoryId` (decision 12).
- `buildView` adds `categoryLimits`, summed from the transactions it already loads.

**Files:** `src/shared/categories.ts`, `src/shared/budget.ts`, `src/server/repos/`
(`types.ts`, `sqlite/categoryLimits.ts` new, `sqlite/index.ts`), `src/server/services/`
(`categoryLimits.ts` new, `categories.ts`, `periods.ts`), `src/server/routes/periods.ts`,
`src/server/app.ts`.

**Tests:** the table in question 3, row by row. A generated period gets the usual limits
and one added before the earliest does not. Creating with `applyToPeriods` reaches the
current and later periods and no earlier one; without it, none. Changing the usual limit
with and without it, including over a limit changed by hand, and removing it. A limit set
by hand on a past period and on one before the budget. Moving a period's boundary moves
the spending and not the limit. Deleting a category removes its limits. No limit change
moves a starting amount. Another user's period and another user's category are each a 404.

### 18.5 Limits on screen

- [x] Done

- The category dialog gains "Usual limit each pay period (optional)" and, when the amount
  is new or changed, the checkbox from decisions 10 and 11.
- A category's card shows its usual limit and, when the current period has a limit for it,
  "$120.00 of $200.00 this period".
- Period settings gains "Category limits": each limit with what has been spent against
  it, a way to change or remove it, and "Add a limit" for the categories without one,
  starting from the usual amount. Each change saves by itself, apart from the dialog's own
  Save.
- The home screen shows one message per category that is over, above the summary card, in
  the wording of question 3. `Alert` gains a warning tone (and `styles.css` a warning
  background, in both themes); it goes on `/dev/ui`.
- Checked at 360px and 1280px, light and dark, with a long category name.

**Files:** `src/client/features/categories/`, `src/client/features/periods/`
(`PeriodSettingsDialog.tsx`, a new section component, `api.ts`),
`src/client/features/home/HomePage.tsx`, `src/client/components/ui/Alert.tsx`,
`src/client/styles.css`, `src/client/features/dev/UiKitPage.tsx`.

### 18.6 The assistant

- [x] Done

- New tools: `list_categories`, `create_category`, `update_category`, `delete_category`,
  `set_period_limit`, `remove_period_limit`.
- `categoryId` on `create_transaction` and `update_transaction`, and in import rows;
  `categoryId` and `applyToTransactions` on `create_bill_or_income` and
  `update_bill_or_income`.
- `get_period` gives each transaction's category, the period's limits with what has been
  spent, and the same over-the-limit sentences the home screen shows. `list_transactions`
  and `list_bills_income` lines name the category.
- `README.md`: categories in the import steps, and how to add limits to past periods.
- `npm run build:mcp`.

**Files:** `mcp/tools.ts`, `mcp/format.ts`, their tests, `README.md`.

**Tests:** through the tools: a category is made with a limit, a past period is given one,
transactions are filed, and `get_period` reports the period over.

### With each task

`domain.md` gains "Categories" and "Limits" sections, the two tables, the new endpoints
and the `PeriodView` field as they are built. This file's "Decided" list is the draft.

## To deploy

Adds migration `0010`: back the database up first. Copy the rebuilt MCP file
(`dist/mcp/ppb-mcp.mjs`) to wherever the assistant runs it. The Android app must be rebuilt
to show any of it; the installed build keeps working without.

## Implementation notes

### 18.1 (2026-10-13)

Built as specified, with the differences below. The rules are in `domain.md` under
"Filing under a category".

- **Migration `0010_categories.sql` was corrected by hand.** `db:generate` wrote both new
  columns as `ADD category_id text REFERENCES categories(id)` with no `ON DELETE`, exactly
  as `CLAUDE.md` warns (its own snapshot says `set null`). With that, deleting a category
  that anything was filed under would have failed. Both now end `ON DELETE set null`. It
  rebuilt no table. `migrations.test.ts` runs it over a filled database: every
  transaction keeps its link to its bill or income, and deleting a category unfiles
  without deleting.
- The migration holds the whole phase's schema, as planned. `period_category_limits` and
  `bills_income.category_id` were there before 18.3 and 18.4 used them; a second migration
  test covers the limit table's cascades.
- `applyToPeriods` was left out of 18.1, unlike the task text, and added with 18.4: a flag
  that does nothing would mislead whoever sends it.
- **Names are unique by a check in the service, with a unique index on
  `(user_id, lower(name))` behind it.** The check compares in JavaScript, so it also
  catches capitals outside ASCII, which SQLite's `lower` does not. The index can never be
  what refuses a name in practice (database access is queued), which is as well:
  SQLite reports a broken expression index by the index's name, which `rethrowConstraint`
  does not read.
- A category's name is at most 40 characters.
- `categoryId` is checked by the link planner (`services/billIncomeLinks.ts`), beside
  `billIncomeId`: one place for a single transaction and for an import, and where 18.3's
  "take the item's category" belongs. An import with a bad one is refused whole, under
  the planner's existing message ("a link that can't be made"), with
  `transactions.N.categoryId` naming the row.
- `repos/sqlite/transactions.ts` needed no change: it selects and inserts whole rows.
- `transactions(category_id)` has an index. Deleting a category has to find its
  transactions, and reports will ask by category.
- `routes/categories.test.ts`, 9 tests; 2 more in `migrations.test.ts`.
- Checked by breaking five rules once each: any category id accepted on create and
  import, and on update; a duplicate name allowed; ownership dropped from the category
  repo; `ON DELETE set null` taken back out of the migration. Each fails a test.
- Nothing of 18.1 is on screen by itself.

### 18.2 to 18.6 (2026-10-13)

Built together, server first and then the screens, so the notes are by area and not by
task. The rules are in `domain.md` under "Filing under a category" and "Limits".

**Where it differs from the task text**

- **`applyToTransactions` is on update only, not on create.** A new bill or income has
  nothing tied to it yet, and the entries it adds get its category anyway.
- **`applyToTransactions` without a `categoryId` is allowed**: it files what is tied to the
  item under the category the item already has. Likewise `applyToPeriods` without a new
  `defaultLimitCents` re-applies the usual limit. Neither is offered on screen; an
  assistant can use them.
- **The checkbox on a bill or income starts unticked**, and the one on a category's usual
  limit starts ticked (decision 10). The first replaces categories on transactions that
  exist; the second is what the owner asked for by default.
- **`remove_period_limit` answers 404 when the period has none for that category**, so an
  assistant is told it changed nothing.
- **A third wording of the warning.** When the paid spending is already over *and* more is
  upcoming: "You went over your budget for Groceries by $15.00 this period. With what's
  upcoming it will be $50.00." Without it the message would either hide the upcoming part
  or call money not yet spent "went over".
- **An upcoming refund can clear a warning.** $215 paid against $200 with a $20 refund
  still upcoming is $195 projected and says nothing, because upcoming counts (question 3)
  in both directions.
- The transaction dialog shows "Category" only once a category exists, and the bill or
  income dialog likewise.
- The bill or income's card also names its category, after the schedule.
- "Cancel" in Period settings reads "Close" while there is nothing to save, since limits
  there are saved as they are changed.

**Server**

- `onPeriodCreated` is now told `"forward"` or `"earlier"`; `app.ts` adds the usual limits
  only for the first. `services/categoryLimits.ts` holds the three pieces: giving a new
  period its limits, bringing current and later periods into line with a usual limit, and
  working out what has been spent.
- Spending is added up in `buildView` from the transactions it already loads. One more
  query per period view: the period's limits joined to their categories' names.
- Setting and removing a period's limit live in the period service, beside the other
  per-period adjustments, and return the `PeriodView` as those do.
- Decision 15 is in the link planner: it now knows each item's category, so one
  transaction and a 500-row import inherit the same way.
- `setCategoryForBillOrIncome` counts only the transactions that were filed differently
  before, so the number reported is the number changed.
- New tests: `routes/categories.limits.test.ts` (16), `routes/billsIncome.categories.test.ts`
  (9), `shared/categories.test.ts` (20), 5 in `mcp/tools.test.ts`. 901 in all;
  `npm run check` and `npm run build` are clean.
- Checked by breaking fourteen rules once each: limits given to a period added before the
  earliest; past periods touched by `applyToPeriods`; other categories' spending counted;
  spending allowed below zero; upcoming counted as paid; a limit set for another user's
  category; exactly-the-limit treated as over; entries not inheriting; refiling without
  being asked; refiling every user's transactions; the item's category and the entry's
  category not inherited; a bill given a category that is not the user's. Thirteen fail a
  test. **The fourteenth does not:** dropping the user filter from the limit repo's
  `delete` changes nothing a test can see, because the service has already checked that
  both the period and the category are the caller's. The filter stays, as the rule in
  `CLAUDE.md` asks.

**Screens**

- `features/categories/`: `CategoriesPage` (cards by name, each with its usual limit and,
  when the current period has a limit for it, "$120.00 of $200.00 this period"),
  `CategoryDialog`, `api.ts`, and `limitInput.ts` (what counts as a typed limit, shared
  with Period settings).
- `features/periods/PeriodLimitsSection.tsx` is the "Category limits" part of Period
  settings. It sits inside that dialog's form, so Enter in one of its fields is caught and
  saves that limit; it must not submit the dates and starting amount.
- `Alert` has `tone="warning"` (`role="status"`, not `"alert"`: it describes how things
  stand and should not interrupt a screen reader each time a period is opened).
  `styles.css` has `--warning-bg` in all three theme blocks. Both are on `/dev/ui`.
- Changing or deleting a category refreshes every cached period and the bills and income
  list. Saving a bill or income refreshes periods only when it refiled transactions.

**Assistant**

- Six new tools, twenty in all: `list_categories`, `create_category`, `update_category`,
  `delete_category`, `set_period_limit`, `remove_period_limit`.
- `categoryId` on `create_transaction`, `update_transaction`, `create_bill_or_income` and
  `update_bill_or_income` (which also takes `applyToTransactions`), and in import rows.
- Lines name a category by id, as they do a bill or income; `list_categories` and the
  limit lines of `get_period` give the names.
- `get_period` has a block of limit lines between the totals and the transactions, and an
  `OVER:` line with the home screen's own sentence for each one passed.
- The import suggests no category. The tool description says so and leaves it to the
  script.
- The MCP client gained `put`, and its `delete` can return a body.
- `README.md`: the tools table, `categoryId` in the import rows, and how to give old
  periods limits.
- **`npm run build:mcp` was run**: `dist/mcp/ppb-mcp.mjs` has the new tools. An assistant
  already running the old file must be restarted.

**Checked in the browser** on the dev account, at 1024px dark and 375px light, with a
temporary category, bill and transactions:

- Adding a category with a usual limit of 200: the checkbox appeared once an amount was
  typed, and the current period had the limit afterwards.
- $120.00 paid and $95.00 upcoming under it: "You're set to go over your budget for Zz Test
  Groceries by $15.00 this period." above the summary; the row shows the category under
  the name. Marking the $95.00 paid changed it to "You went over ...".
- Period settings: the limit row read "$215.00 of $200.00, over by $15.00"; typing 250 and
  pressing Enter saved it, the dialog stayed open and its dates were untouched, and the
  warning went. A second category was added from the list, starting from its usual
  amount, and removed with the bin.
- A bill's dialog: choosing a category showed the checkbox; ticked and saved, the one
  transaction tied to that bill was refiled, a second bill's was not, and the toast read
  "1 transaction filed under ...".
- The transaction dialog: choosing that bill filled in its category.
- A 38-character category name wrapped inside the warning and the Period settings row at
  375px with nothing wider than the screen.
- The category dialog's wording when a usual limit is being taken away was wrong on first
  look ("Replaces the limit those periods have now") and was corrected; looked at again
  afterwards, it reads "Periods that are over keep the limit they have."
- Deleting a category from its dialog.
- Editing a transaction's category: the dialog opened on the one it had, and saving a
  different one changed the row on the home screen and what counted against each limit.

Everything added was deleted afterwards, and the current period's starting amount, totals
and transaction count compared equal to before. The dev database is now on migration
`0010`; `data/app-before-0010.db` is a copy taken just before, and can be deleted.

**Not checked**

- A period before the budget began in Period settings (tested through the API).
- The tools with a real assistant.
- Anything on Android: the installed build predates all of this.
- No component tests exist in this project, so none were added.
