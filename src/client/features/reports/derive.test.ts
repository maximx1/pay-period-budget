import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOR, SERIES_COLORS } from "../../components/charts/palette.ts";
import { mean, NONE, OTHER, rankSeries, spanFor } from "./derive.ts";

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
