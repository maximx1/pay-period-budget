import type { PeriodView } from "../../../shared/budget.ts";
import { netTransfers } from "../../../shared/flows.ts";

/** A period's money, each amount positive. */
export type SummaryFigures = {
  /**
   * Transaction by transaction, by direction and by whether it has happened yet: what the
   * progress bar counts. The Paid section's total is incomePaid - expensesPaid, the
   * Upcoming one's the same for what is to come.
   */
  incomePaidCents: number;
  incomeToComeCents: number;
  expensesPaidCents: number;
  expensesToComeCents: number;
  /**
   * The rest count each transfer's money sent and brought back once, as the difference
   * (netTransfers). Money in and out, paid or not: starting + income - expenses is still
   * the balance at the end of the period.
   */
  incomeCents: number;
  expenseCents: number;
  /** Money out by category id; null for what is filed under none. Each transaction counts under its own category. */
  expensesByCategory: Map<string | null, number>;
  /** Money out tied to a bill, money sent to transfers, and money out tied to neither. */
  expensesFromBillsCents: number;
  expensesToTransfersCents: number;
  expensesSpontaneousCents: number;
};

/**
 * The figures the summary card shows and draws. The direction is the amount's sign.
 * `transfers` holds each transfer's id; until it has loaded, transfers count like bills.
 */
export function summaryFigures(view: PeriodView, transfers: ReadonlySet<string>): SummaryFigures {
  const figures: SummaryFigures = {
    incomePaidCents: 0,
    incomeToComeCents: 0,
    expensesPaidCents: 0,
    expensesToComeCents: 0,
    incomeCents: 0,
    expenseCents: 0,
    expensesByCategory: new Map(),
    expensesFromBillsCents: 0,
    expensesToTransfersCents: 0,
    expensesSpontaneousCents: 0,
  };
  for (const { amountCents, status } of view.transactions) {
    const paid = status === "paid";
    if (amountCents > 0) figures[paid ? "incomePaidCents" : "incomeToComeCents"] += amountCents;
    else figures[paid ? "expensesPaidCents" : "expensesToComeCents"] -= amountCents;
  }
  for (const { amountCents, categoryId, billIncomeId, transfer } of netTransfers(view.transactions, transfers)) {
    if (amountCents > 0) {
      figures.incomeCents += amountCents;
      continue;
    }
    const out = -amountCents;
    figures.expenseCents += out;
    figures[transfer ? "expensesToTransfersCents" : billIncomeId ? "expensesFromBillsCents" : "expensesSpontaneousCents"] += out;
    figures.expensesByCategory.set(categoryId, (figures.expensesByCategory.get(categoryId) ?? 0) + out);
  }
  return figures;
}

/**
 * Whether a period that is over still has anything marked upcoming. Its current balance
 * then disagrees with its balance at the end, and with the bank: whatever it is either
 * happened and wants marking paid, or did not and wants removing or moving.
 */
export function endedWithUpcoming(view: PeriodView, today: string): boolean {
  return view.period.endDate < today && view.transactions.some((transaction) => transaction.status === "upcoming");
}
