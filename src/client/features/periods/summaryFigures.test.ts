import { describe, expect, it } from "vitest";
import type { PeriodView } from "../../../shared/budget.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { endedWithUpcoming, summaryFigures } from "./summaryFigures.ts";

const tx = (amountCents: number, status: Transaction["status"], more: Partial<Transaction> = {}) =>
  ({ amountCents, status, categoryId: null, billIncomeId: null, ...more }) as Transaction;
const figuresOf = (transactions: Transaction[]) => summaryFigures({ transactions } as PeriodView);

describe("summaryFigures", () => {
  it("splits money in from money out, and paid from to come, each as a positive amount", () => {
    expect(
      figuresOf([tx(200_000, "paid"), tx(-5_000, "paid"), tx(-1_250, "paid"), tx(3_000, "upcoming"), tx(-90_000, "upcoming")]),
    ).toMatchObject({ incomePaidCents: 200_000, incomeToComeCents: 3_000, expensesPaidCents: 6_250, expensesToComeCents: 90_000 });
  });

  it("makes the Paid and Upcoming totals when netted", () => {
    const transactions = [tx(10_000, "paid"), tx(-2_500, "paid"), tx(-700, "upcoming"), tx(400, "upcoming")];
    const figures = figuresOf(transactions);
    const net = (status: string) => transactions.filter((t) => t.status === status).reduce((sum, t) => sum + t.amountCents, 0);
    expect(figures.incomePaidCents - figures.expensesPaidCents).toBe(net("paid"));
    expect(figures.incomeToComeCents - figures.expensesToComeCents).toBe(net("upcoming"));
  });

  it("totals money out by category, paid or not, and leaves income out", () => {
    const figures = figuresOf([
      tx(-1_000, "paid", { categoryId: "food" }),
      tx(-500, "upcoming", { categoryId: "food" }),
      tx(-300, "paid"),
      tx(9_999, "paid", { categoryId: "food" }),
    ]);
    expect([...figures.expensesByCategory]).toEqual([
      ["food", 1_500],
      [null, 300],
    ]);
  });

  it("tells money out from a bill apart from money out added on its own", () => {
    const figures = figuresOf([tx(-1_000, "paid", { billIncomeId: "rent" }), tx(-250, "upcoming"), tx(5_000, "paid", { billIncomeId: "pay" })]);
    expect(figures).toMatchObject({ expensesFromBillsCents: 1_000, expensesSpontaneousCents: 250 });
  });

  it("is all zeros for an empty period", () => {
    expect(figuresOf([])).toMatchObject({ incomePaidCents: 0, incomeToComeCents: 0, expensesPaidCents: 0, expensesToComeCents: 0 });
  });
});

describe("endedWithUpcoming", () => {
  const view = (endDate: string, statuses: Transaction["status"][]) =>
    ({ period: { endDate }, transactions: statuses.map((status) => tx(-100, status)) }) as unknown as PeriodView;

  it.each([
    ["over, with something still upcoming", "2026-10-07", ["paid", "upcoming"], true],
    ["over, all paid", "2026-10-07", ["paid"], false],
    ["ends today, something upcoming", "2026-10-14", ["upcoming"], false],
    ["still running", "2026-10-21", ["upcoming"], false],
  ] as const)("%s", (_, endDate, statuses, expected) => {
    expect(endedWithUpcoming(view(endDate, [...statuses]), "2026-10-14")).toBe(expected);
  });
});
