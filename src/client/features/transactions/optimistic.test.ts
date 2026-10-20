import { describe, expect, it } from "vitest";
import type { PeriodView } from "../../../shared/budget.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { mergeOrder, withOrder, withStatus } from "./optimistic.ts";

const tx = (id: string, amountCents: number, status: Transaction["status"]): Transaction => ({
  id,
  name: id,
  amountCents,
  kind: amountCents < 0 ? "expense" : "income",
  occursAt: "2026-01-20T00:00",
  status,
  paidAt: status === "paid" ? "2026-01-15T00:00:00.000Z" : null,
  note: null,
  sortOrder: 0,
  billIncomeId: null,
  occurrenceDate: null,
  importKey: null,
  categoryId: null,
});

const view: PeriodView = {
  period: {
    id: "p",
    seq: 0,
    startDate: "2026-01-13",
    endDate: "2026-01-26",
    nominalStart: "2026-01-13",
    nominalEnd: "2026-01-26",
    datesEdited: false,
    isCurrent: true,
    startingCents: 100_000,
    startingMode: "auto",
    carryStale: false,
  },
  totals: { paidCents: -4000, upcomingCents: 147_300, leftoverCents: 96_000, projectedCents: 243_300 },
  transactions: [tx("rent", -4000, "paid"), tx("ice", -2700, "upcoming"), tx("pay", 150_000, "upcoming")],
  categoryLimits: [],
  dueNotices: [],
  nav: { prevId: null, canAddPrevious: false, nextId: null, nextDate: null },
};

const NOW = "2026-01-16T09:00:00.000Z";

describe("withStatus", () => {
  it("moves an expense into paid", () => {
    const next = withStatus(view, "ice", "paid", NOW);

    expect(next.transactions.find((t) => t.id === "ice")).toMatchObject({ status: "paid", paidAt: NOW });
    expect(next.totals).toEqual({ paidCents: -6700, upcomingCents: 150_000, leftoverCents: 93_300, projectedCents: 243_300 });
  });

  it("moves income into paid", () => {
    expect(withStatus(view, "pay", "paid", NOW).totals).toEqual({
      paidCents: 146_000,
      upcomingCents: -2700,
      leftoverCents: 246_000,
      projectedCents: 243_300,
    });
  });

  it("moves a paid item back to upcoming and clears its paid time", () => {
    const next = withStatus(view, "rent", "upcoming", NOW);

    expect(next.transactions.find((t) => t.id === "rent")).toMatchObject({ status: "upcoming", paidAt: null });
    expect(next.totals).toEqual({ paidCents: 0, upcomingCents: 143_300, leftoverCents: 100_000, projectedCents: 243_300 });
  });

  it("is undone exactly by the opposite change", () => {
    const there = withStatus(view, "ice", "paid", NOW);
    const back = withStatus(there, "ice", "upcoming", NOW);
    expect(back.totals).toEqual(view.totals);
    expect(back.transactions).toEqual(view.transactions);
  });

  it("keeps totals equal to the rows after any sequence of toggles", () => {
    let current = view;
    for (const [id, status] of [["ice", "paid"], ["pay", "paid"], ["rent", "upcoming"], ["ice", "upcoming"], ["rent", "paid"]] as const) {
      current = withStatus(current, id, status, NOW);
      const sum = (s: Transaction["status"]) =>
        current.transactions.filter((t) => t.status === s).reduce((total, t) => total + t.amountCents, 0);
      expect(current.totals.paidCents).toBe(sum("paid"));
      expect(current.totals.upcomingCents).toBe(sum("upcoming"));
      expect(current.totals.leftoverCents).toBe(current.period.startingCents + sum("paid"));
    }
  });

  it("returns the view untouched when there is nothing to do", () => {
    expect(withStatus(view, "missing", "paid", NOW)).toBe(view);
    expect(withStatus(view, "rent", "paid", NOW)).toBe(view);
  });
});

describe("mergeOrder", () => {
  it("rearranges one section's rows and leaves the others where they were", () => {
    // a and c are upcoming, b and d are paid; the user swaps a and c.
    expect(mergeOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "b", "a", "d"]);
  });

  it("handles a group that is entirely one section", () => {
    expect(mergeOrder(["a", "b", "c"], ["b", "c", "a"])).toEqual(["b", "c", "a"]);
  });

  it("leaves the group alone when given nothing to rearrange", () => {
    expect(mergeOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("withOrder", () => {
  const sameMoment: PeriodView = {
    ...view,
    transactions: [
      { ...tx("early", -100, "upcoming"), occursAt: "2026-01-19T00:00" },
      { ...tx("a", -100, "upcoming"), sortOrder: 0 },
      { ...tx("b", -100, "upcoming"), sortOrder: 1 },
      { ...tx("c", -100, "upcoming"), sortOrder: 2 },
      { ...tx("late", -100, "upcoming"), occursAt: "2026-01-21T00:00" },
    ],
  };

  it("reorders within the moment and keeps other times in place", () => {
    const next = withOrder(sameMoment, ["c", "a", "b"]);
    expect(next.transactions.map((t) => t.id)).toEqual(["early", "c", "a", "b", "late"]);
    expect(next.transactions.slice(1, 4).map((t) => t.sortOrder)).toEqual([0, 1, 2]);
    expect(next.totals).toBe(sameMoment.totals);
  });

  it("does not mutate the view it was given", () => {
    withOrder(sameMoment, ["c", "a", "b"]);
    expect(sameMoment.transactions.map((t) => t.id)).toEqual(["early", "a", "b", "c", "late"]);
  });
});
