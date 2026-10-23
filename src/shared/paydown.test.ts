import { describe, expect, it } from "vitest";
import { type Debt, describeMonths, makePlan, payoffMonths, safeToSpare, type Saving, splitOverSavings } from "./paydown.ts";

const debt = (name: string, owedCents: number, aprBps: number | null, monthlyPaymentCents: number | null = null): Debt => ({
  billIncomeId: name.toLowerCase(),
  name,
  owedCents,
  aprBps,
  monthlyPaymentCents,
});
const saving = (name: string, heldCents: number): Saving => ({ billIncomeId: name.toLowerCase(), name, heldCents, aprBps: null });

const visa = debt("Visa", 250_000, 2499, 10_000);
const car = debt("Car", 41_000, 690, 28_900);
const student = debt("Student", 1_200_000, 450, 41_595);
const family = debt("Family", 50_000, null);

/** Each line as [id, cents]. */
const linesOf = (plan: ReturnType<typeof makePlan>) => plan.lines.map((line) => [line.billIncomeId, line.amountCents]);

describe("safeToSpare", () => {
  it.each([
    ["the lowest period limits it", [900_000, 57_800, 59_300], 20_000, { safeCents: 37_800, zeroCents: 57_800, limiting: 1 }],
    ["never below zero", [10_000, -5_000], 20_000, { safeCents: 0, zeroCents: 0, limiting: 1 }],
    ["between zero and the warning", [15_000], 20_000, { safeCents: 0, zeroCents: 15_000, limiting: 0 }],
    ["nothing to go by", [], 20_000, { safeCents: 0, zeroCents: 0, limiting: -1 }],
  ])("%s", (_name, ends, low, expected) => {
    expect(safeToSpare(ends.map((projectedCents) => ({ projectedCents })), low)).toEqual(expected);
  });
});

describe("payoffMonths", () => {
  it.each([
    ["no interest", 100_000, null, 10_000, { months: 10, interestCents: null }],
    // $2,500 at 24.99%, $100 a month: three years, about $1,067 of interest.
    ["interest stretches it", 250_000, 2499, 10_000, { months: 36, interestCents: 106_700 }],
    ["a payment under the interest never ends it", 1_000_000, 2499, 20_000, { months: null, interestCents: null }],
    ["nothing owed", 0, 2499, 10_000, { months: 0, interestCents: 0 }],
    ["no payment", 100, 0, 0, { months: null, interestCents: null }],
  ])("%s", (_name, owed, apr, payment, expected) => {
    const result = payoffMonths(owed, apr, payment);
    expect(result.months).toBe(expected.months);
    if (expected.interestCents !== null && result.interestCents !== null) {
      // Within a dollar either way: rounding each month's interest adds up.
      expect(Math.abs(result.interestCents - expected.interestCents)).toBeLessThan(500);
    } else {
      expect(result.interestCents).toBe(expected.interestCents);
    }
  });
});

describe("splitOverSavings", () => {
  it.each([
    ["one takes it all", [saving("Rainy", 10_000)], 5_000, { rainy: 5_000 }],
    ["the lowest first, up to the next", [saving("A", 10_000), saving("B", 30_000)], 15_000, { a: 15_000 }],
    ["then both together", [saving("A", 10_000), saving("B", 30_000)], 30_000, { a: 25_000, b: 5_000 }],
    ["equals share evenly, odd cents to the first", [saving("A", 0), saving("B", 0)], 101, { a: 51, b: 50 }],
    ["nothing to put in", [saving("A", 0)], 0, {}],
  ])("%s", (_name, savings, cents, expected) => {
    expect(Object.fromEntries(splitOverSavings(cents, savings))).toEqual(expected);
  });
});

describe("makePlan", () => {
  it("fastest pays the highest rate first, with no rate last", () => {
    const plan = makePlan("fastest", 300_000, [car, family, student, visa], [], 0);
    expect(linesOf(plan)).toEqual([
      ["visa", 250_000],
      ["car", 41_000],
      ["student", 9_000],
    ]);
    const visaLine = plan.lines[0]!;
    expect(visaLine.reason).toBe("24.99% APR, the highest; clears it and its $100.00 a month");
    expect(visaLine.payoff).toMatchObject({ monthsAfter: 0 });
    expect(visaLine.payoff!.interestSavedCents).toBe(106_755);
  });

  it("fewest payments clears the smallest balances first", () => {
    const plan = makePlan("fewest", 100_000, [visa, car, family, student], [], 0);
    expect(linesOf(plan)).toEqual([
      ["family", 50_000],
      ["car", 41_000],
      ["visa", 9_000],
    ]);
    expect(plan.lines.find((line) => line.billIncomeId === "car")!.reason).toBe("$410.00 left, the smallest; clears it and its $289.00 a month");
    expect(plan.lines.find((line) => line.billIncomeId === "family")!.reason).toBe("$500.00 left, the next smallest; clears it");
  });

  it("leaves what no debt needs unplaced, when it goes only to debts", () => {
    const plan = makePlan("fastest", 100_000, [car], [], 0);
    expect(linesOf(plan)).toEqual([["car", 41_000]]);
    expect(plan.unplacedCents).toBe(59_000);
  });

  it("balanced builds a month's cushion, then high interest, then halves the rest", () => {
    // $1,500 a month of spending; savings hold $1,000: $500 short.
    const plan = makePlan("balanced", 400_000, [visa, car, student], [saving("Rainy", 100_000)], 150_000);
    // $500 cushion; $2,500 clears the Visa (24.99%); the $1,000 left halves: $500 to savings,
    // $500 to the Car (6.9%, the highest still owing).
    expect(linesOf(plan)).toEqual([
      ["visa", 250_000],
      ["rainy", 100_000],
      ["car", 41_000],
      ["student", 9_000],
    ]);
    expect(plan.lines.find((line) => line.billIncomeId === "rainy")!.reason).toBe(
      "a cushion of about a month's spending ($1,500.00); half of what was left, to savings",
    );
    expect(plan.unplacedCents).toBe(0);
  });

  it("balanced puts everything in savings when there are no debts, and into debts when there are no savings", () => {
    expect(linesOf(makePlan("balanced", 10_000, [], [saving("Rainy", 0)], 150_000))).toEqual([["rainy", 10_000]]);
    expect(linesOf(makePlan("balanced", 10_000, [car], [], 150_000))).toEqual([["car", 10_000]]);
  });

  it("savings goes to the lowest savings first", () => {
    expect(linesOf(makePlan("savings", 20_000, [visa], [saving("Rainy", 0), saving("Holiday", 50_000)], 0))).toEqual([
      ["rainy", 20_000],
    ]);
  });

  it("does nothing with nothing", () => {
    expect(makePlan("balanced", 0, [visa], [saving("Rainy", 0)], 150_000)).toEqual({
      strategy: "balanced",
      amountCents: 0,
      lines: [],
      unplacedCents: 0,
    });
  });
});

describe("a balance in parts", () => {
  // One student loan in three parts: one bill, three debts.
  const part = (partId: string, owedCents: number, aprBps: number): Debt => ({
    billIncomeId: "student",
    partId,
    name: `Student: ${partId}`,
    owedCents,
    aprBps,
    monthlyPaymentCents: null,
  });

  it("plans each part as a debt of its own", () => {
    const parts = [part("1-01", 300_000, 450), part("1-02", 100_000, 680), part("1-03", 200_000, 550)];
    const fastest = makePlan("fastest", 150_000, parts, [], 0);
    expect(fastest.lines.map((line) => [line.billIncomeId, line.partId, line.amountCents])).toEqual([
      ["student", "1-02", 100_000],
      ["student", "1-03", 50_000],
    ]);
    const fewest = makePlan("fewest", 120_000, parts, [], 0);
    expect(fewest.lines.map((line) => [line.partId, line.amountCents])).toEqual([
      ["1-02", 100_000],
      ["1-03", 20_000],
    ]);
  });
});

describe("describeMonths", () => {
  it.each([
    [null, "never at this payment"],
    [0, "now"],
    [7, "in about 7 months"],
    [12, "in about 1 year"],
    [27, "in about 2 years 3 months"],
  ])("%j", (months, text) => {
    expect(describeMonths(months)).toBe(text);
  });
});
