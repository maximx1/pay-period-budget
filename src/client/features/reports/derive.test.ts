import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOR, SERIES_COLORS } from "../../components/charts/palette.ts";
import { CASH_ON_HAND, type CashFlow, cashFlow, INCOME_COLOR, mean, NONE, OTHER, rankSeries, spanFor } from "./derive.ts";

const periods = [
  { id: "p0", startDate: "2026-01-01", endDate: "2026-01-14" },
  { id: "p1", startDate: "2026-01-15", endDate: "2026-01-28" },
  { id: "p2", startDate: "2026-01-29", endDate: "2026-02-11" },
  { id: "p3", startDate: "2026-02-12", endDate: "2026-02-25" },
  { id: "p4", startDate: "2026-02-26", endDate: "2026-03-11" },
];

describe("spanFor", () => {
  it.each([
    ["the last 3, ending with the current period", "3", "2026-02-20", { from: "2026-01-15", to: "2026-02-25" }],
    ["as many as there are when fewer exist", "12", "2026-02-20", { from: "2026-01-01", to: "2026-02-25" }],
    ["everything up to the current period, not beyond it", "all", "2026-02-20", { from: "2026-01-01", to: "2026-02-25" }],
    ["just the first period on its first day", "6", "2026-01-01", { from: "2026-01-01", to: "2026-01-14" }],
    ["the latest period when today is past them all", "3", "2026-06-01", { from: "2026-01-29", to: "2026-03-11" }],
    ["the first period when today is before them all", "3", "2025-06-01", { from: "2026-01-01", to: "2026-01-14" }],
    ["year to date: January 1st through the current period", "ytd", "2026-02-20", { from: "2026-01-01", to: "2026-02-25" }],
    ["year to date on New Year's Day", "ytd", "2026-01-01", { from: "2026-01-01", to: "2026-01-14" }],
    ["year to date past every period into a new year: the latest one", "ytd", "2027-01-05", { from: "2026-02-26", to: "2026-03-11" }],
  ] as const)("%s", (_case, choice, today, expected) => {
    expect(spanFor(choice, periods, today)).toEqual(expected);
  });

  it("starts year to date on January 1st even inside a period that began in December, which the report counts whole", () => {
    const straddling = [
      { id: "d0", startDate: "2025-12-15", endDate: "2025-12-28" },
      { id: "d1", startDate: "2025-12-29", endDate: "2026-01-11" },
      { id: "d2", startDate: "2026-01-12", endDate: "2026-01-25" },
    ];
    expect(spanFor("ytd", straddling, "2026-01-05")).toEqual({ from: "2026-01-01", to: "2026-01-11" });
    expect(spanFor("ytd", straddling, "2026-01-20")).toEqual({ from: "2026-01-01", to: "2026-01-25" });
  });

  it("has no dates of its own for a custom span, or with no periods", () => {
    expect(spanFor("custom", periods, "2026-02-20")).toBeNull();
    expect(spanFor("6", [], "2026-02-20")).toBeNull();
  });
});

describe("rankSeries", () => {
  const names: Record<string, string> = { a: "Rent", b: "Food", c: "Fun" };
  const nameOf = (id: string) => names[id];

  it("colours by size, largest first, with what belongs to nothing in grey at the end", () => {
    const { series, keyOf } = rankSeries(new Map<string | null, number>([["b", 500], [null, 9_000], ["a", 2_000], ["c", 0]]), nameOf, "Uncategorised");
    expect(series).toEqual([
      { key: "a", name: "Rent", color: SERIES_COLORS[0] },
      { key: "b", name: "Food", color: SERIES_COLORS[1] },
      { key: NONE, name: "Uncategorised", color: NEUTRAL_COLOR },
    ]);
    expect([keyOf("a"), keyOf("b"), keyOf(null)]).toEqual(["a", "b", NONE]);
  });

  it("folds everything past the seventh into Other, which takes the last colour", () => {
    const totals = new Map<string | null, number>(Array.from({ length: 10 }, (_, n) => [`id${n}`, 1_000 - n]));
    const { series, keyOf } = rankSeries(totals, () => undefined, "None");
    expect(series.map((entry) => entry.key)).toEqual(["id0", "id1", "id2", "id3", "id4", "id5", "id6", OTHER]);
    expect(series.at(-1)).toEqual({ key: OTHER, name: "Other", color: SERIES_COLORS[7] });
    expect(new Set(series.map((entry) => entry.color)).size).toBe(8);
    expect([keyOf("id6"), keyOf("id7"), keyOf("id9")]).toEqual(["id6", OTHER, OTHER]);
    // Something deleted since still has a name to show.
    expect(series[0]!.name).toBe("Deleted");
  });

  it("is steady: equal amounts keep one order, and nothing with no money is drawn", () => {
    const first = rankSeries(new Map<string | null, number>([["b", 100], ["a", 100]]), nameOf, "None");
    const second = rankSeries(new Map<string | null, number>([["a", 100], ["b", 100]]), nameOf, "None");
    expect(first.series).toEqual(second.series);
    expect(rankSeries(new Map<string | null, number>([["a", 0], [null, 0]]), nameOf, "None").series).toEqual([]);
  });
});

describe("mean", () => {
  it.each([
    [[], 0],
    [[100], 100],
    [[100, 201], 151],
    [[0, 0, 100], 33],
  ])("of %j is %i", (values, expected) => {
    expect(mean(values)).toBe(expected);
  });
});

describe("cashFlow", () => {
  const names: Record<string, string> = { pay: "Paycheck", side: "Side job", rent: "Rent", food: "Food" };
  const nameOf = (id: string) => names[id];
  const flow = (
    sourceIn: Array<[string | null, number]>,
    categoryOut: Array<[string | null, number]>,
    leftover: { startedWith: number; cashOnHand: number } = { startedWith: 0, cashOnHand: 0 },
  ) => {
    const inMap = new Map(sourceIn);
    const outMap = new Map(categoryOut);
    return cashFlow(inMap, rankSeries(inMap, nameOf, "Other income"), outMap, rankSeries(outMap, nameOf, "Uncategorised"), leftover);
  };
  const summary = (result: CashFlow | null) =>
    result && {
      sources: result.sources.map((node) => [node.name, node.value]),
      total: [result.total.name, result.total.value],
      uses: result.uses.map((node) => [node.name, node.value]),
    };

  it("puts what the span started with after income, and the cash on hand before the categories", () => {
    const leftover = { startedWith: 50_000, cashOnHand: 260_000 };
    expect(summary(flow([["pay", 400_000], [null, 20_000]], [["rent", 150_000], ["food", 50_000], [null, 10_000]], leftover))).toEqual({
      sources: [["Paycheck", 400_000], ["Other income", 20_000], ["Started with", 50_000]],
      total: ["Income and what you started with", 470_000],
      uses: [["Cash on hand", 260_000], ["Rent", 150_000], ["Food", 50_000], ["Uncategorised", 10_000]],
    });
  });

  it("never counts what was left over as income: spending past income comes from what it started with", () => {
    expect(summary(flow([["pay", 100_000]], [["rent", 150_000]], { startedWith: 80_000, cashOnHand: 30_000 }))).toEqual({
      sources: [["Paycheck", 100_000], ["Started with", 80_000]],
      total: ["Income and what you started with", 180_000],
      uses: [["Cash on hand", 30_000], ["Rent", 150_000]],
    });
  });

  it("balances anything else that moved the leftover with Adjustments, on the short side", () => {
    // A starting amount set $20 higher by hand partway through.
    expect(summary(flow([["pay", 100_000]], [["rent", 60_000]], { startedWith: 10_000, cashOnHand: 52_000 }))).toEqual({
      sources: [["Paycheck", 100_000], ["Started with", 10_000], ["Adjustments", 2_000]],
      total: ["Income and what you started with", 112_000],
      uses: [["Cash on hand", 52_000], ["Rent", 60_000]],
    });
    // Ending below zero: nothing on hand, and the overdraft balances the spending.
    expect(summary(flow([["pay", 100_000]], [["rent", 130_000]], { startedWith: 10_000, cashOnHand: -20_000 }))).toEqual({
      sources: [["Paycheck", 100_000], ["Started with", 10_000], ["Adjustments", 20_000]],
      total: ["Income and what you started with", 130_000],
      uses: [["Rent", 130_000]],
    });
  });

  it("has neither leftover with none, and nothing at all with no money", () => {
    expect(summary(flow([["pay", 100_000]], [["rent", 100_000]]))).toEqual({
      sources: [["Paycheck", 100_000]],
      total: ["Income", 100_000],
      uses: [["Rent", 100_000]],
    });
    expect(flow([], [], { startedWith: 5_000, cashOnHand: 5_000 })).toBeNull();
    expect(flow([["pay", 0]], [["rent", 0]])).toBeNull();
  });

  it("draws income and the cash on hand in the app's colour, and categories in their own", () => {
    const result = flow([["pay", 400_000]], [["rent", 150_000], [null, 10_000]], { startedWith: 1_000, cashOnHand: 241_000 })!;
    expect(result.sources.map((node) => node.color)).toEqual([INCOME_COLOR, NEUTRAL_COLOR]);
    expect(result.uses.map((node) => node.color)).toEqual([INCOME_COLOR, SERIES_COLORS[0], NEUTRAL_COLOR]);
  });

  it("adds everything past the seventh category into Other", () => {
    const many = Array.from({ length: 9 }, (_, n): [string, number] => [`c${n}`, 1_000 - n]);
    const result = flow([["pay", 100_000]], many, { startedWith: 0, cashOnHand: 100_000 - 8_964 })!;
    expect(result.uses.map((node) => node.key)).toEqual([CASH_ON_HAND, "c0", "c1", "c2", "c3", "c4", "c5", "c6", OTHER]);
    expect(result.uses.at(-1)!.value).toBe(993 + 992);
  });
});
