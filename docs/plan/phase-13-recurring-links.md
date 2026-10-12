# Phase 13: Transactions that belong to a recurring item

**Goal:** any transaction can be tied to a recurring item, not only the ones the app
generated from it. An import recognises which rows belong to which item, an assistant can
create and change recurring items, and the Recurring page shows everything paid to (or
received from) each one.

**Depends on:** phase 5 (recurring items), phase 11 (import, MCP).
**Suggested model:** Opus for 13.1 to 13.3 (they change what a recurring item is and how
paying one moves the totals); Sonnet for the rest.

**Status:** planned 2026-10-12 from the owner's description. The owner took both
suggestions below the same day; 13.1 started.

## What the owner asked for

1. The import should recognise a transaction that belongs to a recurring item, and the API
   and MCP server should let an assistant look that up and make the link.
2. The assistant should be able to create and change recurring items.
3. Something permanent, such as a credit card "that might or might not need money paid
   into it": it has no fixed schedule, but payments to it should still be grouped.
4. A one-off transaction can be linked to a recurring item when it is entered.
5. Several transactions can go to the same item (a bill paid in three small parts).
6. On the Recurring page, clicking a card shows that item's transactions: about ten, then
   "more" for the whole list, loading 30 at a time as it scrolls. Not on the home page.

## What is already there

- `transactions.recurring_id` exists. Today only generated transactions have it, together
  with `occurrence_date`. Nothing stops other transactions carrying the id: the unique
  index is on `(recurring_id, occurrence_date)` and a linked one-off has no occurrence date.
- `Transaction.recurringId` is already in every API response, and the home screen already
  marks a row that has one.
- `/api/recurring` has list, create, preview, update, end and delete. The MCP server only
  has `list_recurring`.
- The import's dry run already reports a bank row that looks like a generated occurrence
  (same amount, within three days).

## Clarified by the owner (2026-10-12, after 13.1)

The credit card **does** have a schedule: "normally I pay on the 5th and it's $200". That
entry should keep being generated. On top of it come extra payments ("another $25, then
$35, then $100") entered as one-off transactions and tied to the same item.

That is what `recurringId` without `countsToward` does: an extra payment, grouped with the
item, which leaves the scheduled entry alone. So:

- 13.2 (items with no schedule) was dropped at this point, since the card did not need
  it. The owner then gave a case that does (occasional income from side jobs), and it was
  built; see its notes.
- The two ways of tying a payment to an item are both needed and mean different things:
  *extra* (`recurringId`: the $25 on top of the $200) and *part of the scheduled entry*
  (`countsToward`: $300 of the $900 rent). The dialog in 13.6 has to make that plain.

## Questions for the owner (both answered 2026-10-12: as suggested)

**1. Is the credit card a recurring item without a schedule, or the first "account"?**

Decision 11 reserves *accounts* for the places money lives or goes (savings, a person you
pay). A credit card you pay now and then sits between the two ideas.

Suggested: **a recurring item with no schedule.** Add "No schedule" beside every week,
month, year and pay period. Such an item generates nothing; it exists so that payments can
be tied to it and seen together. It keeps one concept, one page and one detail view, and
leaves *accounts* free for the day balances and transfers are wanted. Its usual amount
would be optional, since a card payment varies.

The alternative is to start the Accounts feature now. That is a larger piece of work and
would split "things I pay" across two pages.

**2. When a scheduled bill is paid in parts, what happens to the one upcoming entry the
app created for it?**

Say rent is $900 and the app has added "Rent, $900, upcoming". You pay $300 three times.

Suggested: **each part can be marked as paying toward that entry, which shrinks it.**
After the first part: "Rent, $600, upcoming" and "Rent, $300, paid". After the third the
upcoming entry is gone. Paying a part never changes the projected leftover (the money
moves from upcoming to paid), which is what a part payment means. It is explicit: the
person or assistant says which upcoming entry a payment counts toward; nothing is guessed.
A payment linked to the item *without* that leaves the upcoming entry alone, which is
right for an extra payment.

The alternative is to leave the upcoming entry untouched always and have you edit or
delete it by hand.

## Tasks

### 13.1 Linking a transaction to a recurring item (API)

- [x] Done

- `recurringId` (optional, nullable) on `POST /api/transactions`, `PATCH
  /api/transactions/:id` and on each import row. It must be one of the caller's items;
  anything else is a field error, never a 404 that reveals another user's id.
- A patch with `recurringId: null` unlinks. A generated transaction can be unlinked or
  moved to another item like any other; its `occurrenceDate` stays, so the occurrence is
  not generated a second time.
- If question 2 is answered as suggested: `countsToward` (the id of an upcoming generated
  transaction of the same item) on create and on import rows. In the same database
  transaction the upcoming entry's amount is reduced by the payment, and the entry is
  deleted when nothing is left. An overpayment removes it and stops there. Deleting or
  editing the payment afterwards does not bring the upcoming entry back; say so in the
  response and the tool description.

**Tests:** link on create, on patch, on import; unlink; another user's item is refused the
same way as one that does not exist; starting amounts are unchanged by linking alone;
counting toward an entry leaves the projected leftover unchanged and removes the entry at
zero.

### 13.2 Recurring items with no schedule

Dropped on 2026-10-12 after the owner's first clarification, then **asked for again the
same day** with a case of its own: money from a friend for a day's roofing, then nothing
for months, all to be gathered under one item.

- [x] Done

- `recurrenceUnit: "none"`. It produces no occurrences, in generation and in back-fill.
  `firstDueDate` is not asked for; `nextDueDate` is null; the schedule reads "No schedule".
- `defaultAmountCents` may be 0 for these, meaning "no usual amount". Stored as 0 so the
  column needs no change. Every other unit still requires an amount.
- "End this" archives it as now.

**Tests:** creating one adds no transactions, in existing periods or new ones; switching an
item between "none" and a schedule changes only what is generated from then on.

### 13.3 An item's transactions

- [x] Done

- `GET /api/recurring/:id/transactions?limit=&before=` → newest first, `limit` up to 100
  (default 30), `before` a cursor from the previous page → `{ transactions, nextCursor,
  totals: { count, paidCents, upcomingCents } }`. The cursor is the last row's date-time
  and id, so rows sharing a moment are neither skipped nor repeated.
- Another user's item is a 404.

### 13.4 The import recognises recurring items

- [x] Done

- The dry run gains `recurringSuggestions: [{ index, recurringId, reason }]`, at most one
  per row:
  - `same_description`: an earlier transaction linked to that item has the same note or
    name. This is how the import learns: once "CAPITAL ONE MOBILE PMT" has been tied to
    the card, the next one is suggested.
  - `occurrence`: the row is already reported as a possible duplicate of one of the item's
    generated entries.
  - `name`: the item's name appears in the row's name or note.
- Suggestions are never applied by the server. The assistant puts `recurringId` (and
  `countsToward`) on the rows it agrees with and runs the import again.

### 13.5 MCP tools

- [x] Done

- `create_recurring` (previews what it would add to existing periods unless told to save,
  as the import does), `update_recurring`, `end_recurring`, `delete_recurring`,
  `list_recurring_transactions`.
- `recurringId` on `create_transaction` and `update_transaction`; `recurringId` and
  `countsToward` in the import file's rows; suggestions in the dry-run report.
- The README's import steps gain "link rows to recurring items".

### 13.6 Choosing the item when entering a transaction

- [ ] Done

- "Recurring item" in the add and edit dialog: None, then the items by name. Picking one
  while adding fills in the name, and the amount if the item has a usual one and the field
  is empty.
- If question 2 is answered as suggested and the item has an upcoming entry in the
  transaction's period: a checkbox, "Counts toward the $900.00 due Oct 25".

### 13.7 The detail view on the Recurring page

- [ ] Done

- Clicking a card opens the item: its schedule and amount, totals, and its ten most recent
  transactions, each showing date, amount and paid or upcoming, and linking to its period.
  The pencil still edits.
- "All transactions" opens `/recurring/:id`: the whole list, newest first, 30 at a time,
  loading the next page as the end comes into view, with a "Load more" button as the
  fallback when that cannot be detected.
- From 360px up, light and dark; empty and error states with the shared primitives.

## Implementation notes

### 13.1 (2026-10-12)

Built as specified. The rules are in `domain.md` under "Linking to a recurring item".

- `src/server/services/recurringLinks.ts` holds it: `createLinkPlanner(repos, userId)`
  checks one transaction's links at a time (`plan`) and, once the paying transactions are
  saved, shrinks or deletes the entries paid toward (`apply`). Creating one transaction
  and importing five hundred use the same planner, which is what lets several rows of one
  import share an entry.
- `recurringId` and `countsToward` are fields of `transactionInputSchema`, so import rows
  have them too; `recurringId` alone is on `transactionPatchSchema`. `countsToward` is not
  offered on update: paying toward something is said when the payment is entered.
- `Transaction` gained `occurrenceDate`. `TransactionResponse` has `countedToward` when
  the request named one; `TransactionImportResponse` has a `countedToward` list.
- A payment toward an entry that an earlier row of the same import already paid off is
  accepted: nothing is left to shrink, and it is simply a linked payment.
- **This also fixes a weakness in the import steps written in phase 11.** Those said: for
  a bank row that matches a generated entry, take the row out of the file and update the
  entry. The updated entry has no import key, so every later export that still lists the
  row reported it as a possible duplicate again. With `countsToward` the bank's row is
  imported under its key and replaces the entry, so the next export skips it. A test
  walks through exactly that. **The README's import steps and the MCP tool's dry-run
  wording still describe the old way; changing them is part of 13.5.**
- The MCP server validates import files with the shared row schema, so a file may already
  carry `recurringId` and `countsToward`, but only once the MCP file is rebuilt: an older
  build drops fields it does not know. Its transaction lines now say "tied to recurring
  item <id>" or "generated from recurring item <id>".
- Server only; nothing new on screen. The home screen already marks a row that has a
  `recurringId`, so a linked one-off now shows that mark.
- Checked by breaking six rules once each (the shrink not carried forward, any item id
  accepted, any transaction payable toward, an overpayment going negative, and a row that
  pays an entry still reported as its duplicate, which first slipped through and got its
  own test): each fails a test in `routes/transactions.links.test.ts`.

### 13.3 (2026-10-12)

- `GET /api/recurring/:id/transactions` → `RecurringTransactionsResponse` in
  `src/shared/recurring.ts`: one page of everything tied to the item, generated or linked
  afterwards, newest first; `nextCursor` (null at the end); and `totals` over the whole
  item, not just the page: `{ count, paidCents, upcomingCents }`, signed.
- `limit` defaults to 30 and stops at 100. `before` takes the previous page's
  `nextCursor`, which is the last row's date-time and id joined by an underscore. Clients
  should treat it as opaque.
- **Order is by date-time, then id**, not the manual order of the home screen. Manual
  order sorts a moment's transactions across all items, which means nothing inside one
  item's list; the id gives a stable order to page through. A test pages through nine
  transactions, five of them at the same moment, at seven different page sizes.
- The owner's own example is the first test: a card generated at $200 on the 5th, plus
  $25, $35 and $100 tied to it.
- An item that does not exist and someone else's get the same 404.
- No new index: filtering by `recurring_id` uses the existing unique index on
  `(recurring_id, occurrence_date)`.
- The response does not say which period each transaction is in. The detail view (13.7)
  can find it from the period list it already loads for the go-to-date dialog.
- Checked by breaking four rules once each (ownership not checked, ties at a page boundary
  skipped, a cursor offered at the end, oldest first): each fails a test in
  `routes/recurring.transactions.test.ts`.

### 13.2 (2026-10-12)

- `recurrenceUnit: "none"`, in `RECURRENCE_UNITS`. `occurrencesBetween` returns nothing
  for it, so neither generation, back-fill nor the preview needs to know about it;
  `nextOccurrence` is null and `describeRecurrence` says "No schedule".
- No migration. The unit is text, the amount is stored as 0 for "no usual amount", and
  `first_due_date` (still not null) holds the day the item was added.
- `recurringInputSchema`: `firstDueDate` is optional and `defaultAmountCents` may be 0,
  each only when the unit is `none`; anything with a schedule is refused without them.
  An edit is checked after merging, so an item cannot be left with a schedule and no
  amount.
- Giving an item a schedule later, or taking it away, changes only what is generated from
  then on, as any edit does.
- The dialog: "never (no schedule)" at the end of the Repeats list, shown as "No schedule"
  once chosen. The number, the first due date and the end date go away; the amount
  becomes "Usual amount (optional)"; a line says nothing is added by itself. The card
  shows "No schedule" and no amount when there is none.
- "End this" still archives one. Its wording ("it stops repeating") is slightly off for
  something that never repeated; left alone until the naming question is settled.
- The MCP server's `list_recurring` lines now give the kind, and say "no usual amount".
- The owner's example is a test: one income item with no schedule, three payments tied to
  it across eleven months, listed together with their total.
- Checked in the browser on the dev account at 1280px dark and 375px light: choosing no
  schedule, saving with no amount, and the card. The test item was deleted afterwards.
- Checked by breaking three rules once each (such an item generating like a monthly one,
  a repeating item accepted with no amount, an edit leaving one that way).

### 13.4 (2026-10-12)

- `recurringSuggestions` on the import response (dry run and real run alike):
  `RecurringSuggestion` in `src/shared/transactions.ts`. Each also carries the item's
  name, and an `occurrence` suggestion carries `countsToward`, so accepting one is copying
  two values onto the row. A test does exactly that.
- Built in `suggestRecurring` in `services/import.ts`, in the order the task lists: the
  upcoming entry, then a description learned from earlier links, then the item's name.
- **How it learns.** `transactions.listLinkedDescriptions` returns each distinct name and
  note among transactions tied to items. A description that is just the item's own name
  is ignored there (generated entries all have it) and left to the name rule. So the
  first time "CAPITAL ONE MOBILE PMT 4417" appears there is nothing to suggest; once a
  row with that note has been tied to the card, every later one is suggested.
- Comparison ignores case and treats any run of spaces or punctuation as one space. Item
  names shorter than three characters are not matched by name, and a name must appear as
  whole words: "Rent" is not found in "Current account".
- **Possible duplicates changed slightly:** `reason: "recurring"` now means an entry an
  item *generated*. A transaction typed in and merely tied to an item is `manual`, which
  it is. Before 13.1 nothing could be tied by hand, so the two were the same thing.
- No suggestion to pay toward an entry that is already paid; that row is still reported
  as a possible duplicate, which is what it then is.
- An item deleted after transactions were tied to it leaves those transactions untied (the
  existing rule), so nothing learned from it survives.
- **Not yet shown to anyone:** the MCP import report ignores the new field until 13.5.
- Checked by breaking six rules once each. Five failed a test at once. The sixth, dropping
  the per-user filter from the descriptions query, did not, because another user's item is
  dropped again before anything is returned; but it would let someone else's later use of
  a description hide your own link, and there is now a test for that.

### 13.5 (2026-10-12)

- Five new tools, fourteen in all: `list_recurring_transactions`, `create_recurring`,
  `update_recurring`, `end_recurring`, `delete_recurring`. The tool names keep
  "recurring" until the code is renamed; their descriptions say "bills and income".
- `create_recurring` is a dry run unless told otherwise, like the import: it calls
  `/api/recurring/preview` and says how many transactions saving would add, and how many
  of the periods are already over. `end_recurring` makes the caller choose
  `removeUpcoming`; there is no default.
- `create_transaction` takes `recurringId` and `countsToward`; `update_transaction` takes
  `recurringId`. When a payment counts toward an entry the result says what was due and
  what is left.
- **The import report** now has, in this order: the per-period totals, today's figures,
  upcoming entries paid toward, the recurring suggestions, and the possible duplicates.
  - Each suggestion ends with the exact text to add to the row: `"countsToward": "<id>"`
    for a row that matches an expected bill (that alone ties it to the item too), or
    `"recurringId": "<id>"`.
  - A row that matches an expected bill is listed once, under the suggestions, and no
    longer also as a possible duplicate.
  - Payments toward one entry from different requests of a large file are added up.
    `CountedToward` gained `previousCents` for this: what each request took off an entry
    can be summed whether the requests were undone (a dry run) or saved.
- The README's import steps describe the new way. The old advice (take the row out and
  update the expected entry by hand) is gone; see the 13.1 note for why it was wrong.
- **Fixed on the way: "End this" with "remove upcoming" deleted every upcoming transaction
  tied to the item**, including ones typed in and tied by hand since 13.1. It now removes
  only the entries the item generated. `listUpcomingForRecurringAfter` requires an
  occurrence date. A test covers it.
- The built MCP file must be rebuilt (`npm run build:mcp`) for any of this to reach an
  assistant.
- Checked by breaking three report rules once each (payments from separate requests not
  added up, a matching row listed twice, a suggestion that never offers `countsToward`).
  Not yet run with a real assistant.

## The name: "Bills & income" (agreed 2026-10-12)

The owner pointed out that "recurring" no longer fits: some of these never repeat. The
screen already says "Bills" and "Income" in its filter and in the dialog; only the page
title, the navigation and "Add recurring" say "Recurring". The owner agreed to this plan:

- Call the page **Bills & income**. One of them is a *bill* (money out) or an *income*
  (money in), with or without a schedule.
- Keep **Accounts** for where money sits (savings, the joint checking account). A regular
  transfer to savings is then a bill that *points at* an account, which is how
  `backlog.md` already describes the Accounts feature.
- Rename what is on screen first. Renaming the code (`recurring_items`, `/api/recurring`,
  `features/recurring`, the MCP tools, `CLAUDE.md`) is a separate, mechanical task: it
  touches the table name, every endpoint and the phone app, and should not be mixed into
  a feature.

The on-screen rename is to be done with the screen work in 13.6 and 13.7. Until the code
is renamed, `CLAUDE.md`'s rule stands as written: in code they are recurring items.
