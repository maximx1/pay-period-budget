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
