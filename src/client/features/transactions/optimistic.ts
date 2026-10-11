import type { PeriodView } from "../../../shared/budget.ts";
import type { TransactionStatus } from "../../../shared/transactions.ts";

/**
 * The period view as it will look once a transaction's status change is saved: the row
 * switches section and its amount moves between the paid and upcoming totals. The projected
 * leftover counts both, so it stays as it was. Returns the same object when nothing applies.
 */
export function withStatus(view: PeriodView, transactionId: string, status: TransactionStatus, paidAt: string): PeriodView {
  const target = view.transactions.find((transaction) => transaction.id === transactionId);
  if (!target || target.status === status) return view;

  const intoPaid = status === "paid" ? target.amountCents : -target.amountCents;
  return {
    ...view,
    transactions: view.transactions.map((transaction) =>
      transaction === target ? { ...target, status, paidAt: status === "paid" ? paidAt : null } : transaction,
    ),
    totals: {
      ...view.totals,
      paidCents: view.totals.paidCents + intoPaid,
      upcomingCents: view.totals.upcomingCents - intoPaid,
      leftoverCents: view.totals.leftoverCents + intoPaid,
    },
  };
}

/**
 * A full same-moment group's ids with one section's rows rearranged in place. Rows of the
 * other section keep their positions, so marking something paid later doesn't jumble it.
 */
export function mergeOrder(groupIds: string[], sectionOrder: string[]): string[] {
  const inSection = new Set(sectionOrder);
  let next = 0;
  return groupIds.map((id) => (inSection.has(id) ? (sectionOrder[next++] ?? id) : id));
}

/** The period view with the given transactions put in that order among themselves. */
export function withOrder(view: PeriodView, ids: string[]): PeriodView {
  const position = new Map(ids.map((id, index) => [id, index]));
  const transactions = view.transactions
    .map((transaction) =>
      position.has(transaction.id) ? { ...transaction, sortOrder: position.get(transaction.id) ?? 0 } : transaction,
    )
    // Stable: anything that still ties keeps the order the server gave it.
    .sort((a, b) => (a.occursAt < b.occursAt ? -1 : a.occursAt > b.occursAt ? 1 : a.sortOrder - b.sortOrder));
  return { ...view, transactions };
}
