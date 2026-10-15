import type { PeriodView } from "../../../shared/budget.ts";

/** A period's money split by direction and by whether it has happened yet. All positive. */
export type SummaryFigures = {
  incomePaidCents: number;
  incomeToComeCents: number;
  expensesPaidCents: number;
  expensesToComeCents: number;
  /** Money out, paid or not, by category id; null for what is filed under none. */
  expensesByCategory: Map<string | null, number>;
  /** Money out that came from a bill (or a transfer), and money out added on its own. */
  expensesFromBillsCents: number;
  expensesSpontaneousCents: number;
};

/**
 * Each direction by itself, paid and upcoming apart. Netted together they would hide each
 * other: the Paid section's total is incomePaid - expensesPaid, the Upcoming one's the same
 * for what is to come. The direction is the amount's sign, which also covers transfers.
 */
export function summaryFigures(view: PeriodView): SummaryFigures {
  const figures: SummaryFigures = {
    incomePaidCents: 0,
    incomeToComeCents: 0,
    expensesPaidCents: 0,
    expensesToComeCents: 0,
    expensesByCategory: new Map(),
    expensesFromBillsCents: 0,
    expensesSpontaneousCents: 0,
  };
  for (const { amountCents, status, categoryId, billIncomeId } of view.transactions) {
    const paid = status === "paid";
    if (amountCents > 0) {
      figures[paid ? "incomePaidCents" : "incomeToComeCents"] += amountCents;
      continue;
    }
    const out = -amountCents;
    figures[paid ? "expensesPaidCents" : "expensesToComeCents"] += out;
    figures[billIncomeId ? "expensesFromBillsCents" : "expensesSpontaneousCents"] += out;
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
