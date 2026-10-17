# Phase 23: Moving everything under a category, and merging

Asked for 2026-10-16. Before this, deleting a category left its transactions and its bills
and income with no category (`ON DELETE SET NULL`) and removed its limits.

## What was built

- `POST /api/categories/:id/move { toCategoryId, deleteAfter }`: files every transaction
  under the category (every pay period, past ones too) and every bill or income under
  another. With `deleteAfter` the emptied category is then deleted with its limits, which
  makes it a merge. One transaction: all of it happens or none. Answers with how many of
  each moved. Refuses the same category, one that does not exist and someone else's (400
  on `toCategoryId`); someone else's source is a 404.
- Repo methods `TransactionRepo.moveCategory` and `BillsIncomeRepo.moveCategory`.
- Edit category dialog: **Move everything…** opens a panel with the destination and a
  "Delete it afterwards" box. **Delete** now offers "Move what's filed under it to", with
  No category as the default, so deleting behaves as before unless a destination is
  picked. A toast says what moved (`moveMessage.ts`).
- MCP tool `move_category` (destructive), and `delete_category` now points at it.
  **Rebuild the MCP file** (`npm run build:mcp`).

## Decisions (overrule any)

- Limits do not move: the destination keeps its own, and the moved category's go with it
  if it is deleted. Adding the two together was the alternative.
- Everything moves; there is no "only from this period on".

## Checked

Endpoint tests (move, merge, refusals, another user), MCP tool test, and in a browser:
moved and merged two throwaway categories on the demo account, and looked at the delete
panel at 375px in dark mode. The toast was not seen on screen.
