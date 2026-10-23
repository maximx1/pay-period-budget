import { describe, expect, it } from "vitest";
import {
  asksFor,
  balanceCheckInputSchema,
  blendedAprBps,
  formatApr,
  monthlyInterestCents,
  nextCheckOn,
  parseAprInput,
  partsInterestCents,
  shareOverParts,
} from "./balances.ts";

describe("nextCheckOn", () => {
  it.each([
    // About a month: 23 to 37 days.
    ["2026-01-15", 30, 0, "2026-02-07"],
    ["2026-01-15", 30, 0.5, "2026-02-14"],
    ["2026-01-15", 30, 0.999, "2026-02-21"],
    // About two weeks: 11 to 17 days.
    ["2026-01-15", 14, 0, "2026-01-26"],
    ["2026-01-15", 14, 0.999, "2026-02-01"],
    // Never the same day.
    ["2026-01-15", 1, 0, "2026-01-16"],
  ])("from %s every %i days with %f is %s", (from, days, random, expected) => {
    expect(nextCheckOn(from, days, random)).toBe(expected);
  });
});

describe("asksFor", () => {
  const items = [
    { billIncomeId: "c", name: "Car", nextCheckOn: "2026-02-10" },
    { billIncomeId: "a", name: "Amex", nextCheckOn: "2026-02-12" },
    { billIncomeId: "b", name: "Boat", nextCheckOn: "2026-02-10" },
    { billIncomeId: "d", name: "Dentist plan", nextCheckOn: "2026-02-20" },
  ];

  it.each([
    ["oldest due first, then by name", 3, 0, ["b", "c", "a"]],
    ["fewer once some were handled today", 3, 2, ["b"]],
    ["none once the day's are used", 3, 3, []],
    ["never fewer than none", 1, 4, []],
    ["the day's limit", 2, 0, ["b", "c"]],
  ])("%s", (_name, perDay, handled, expected) => {
    expect(asksFor(items, "2026-02-12", perDay, handled)).toEqual(expected);
  });
});

describe("rates", () => {
  it.each([
    ["24.99", 2499],
    ["24.99%", 2499],
    [" 5 ", 500],
    ["5.5", 550],
    ["0", 0],
    ["999.99", 99_999],
    ["1000", null],
    ["24.999", null],
    ["-3", null],
    ["", null],
    ["abc", null],
  ])("reads %j as %j", (text, bps) => {
    expect(parseAprInput(text)).toBe(bps);
  });

  it.each([
    [2499, "24.99%"],
    [550, "5.5%"],
    [500, "5%"],
    [0, "0%"],
  ])("writes %i as %s", (bps, text) => {
    expect(formatApr(bps)).toBe(text);
  });

  it.each([
    [-1_000_000, 2499, 20_825],
    [500_000, 400, 1_667],
    [-1_000_000, null, null],
    [0, 2499, 0],
  ])("a month's interest on %i at %j is %j", (balance, apr, interest) => {
    expect(monthlyInterestCents(balance, apr)).toBe(interest);
  });
});

describe("shareOverParts", () => {
  it.each([
    ["by balance", [-300_000, -100_000], 40_000, [30_000, 10_000]],
    ["a payment lowers what is owed: shares are as signed as what moved", [-300_000, -100_000], -40_000, [-30_000, -10_000]],
    ["whole cents adding up exactly, the largest remainder first", [-100, -100, -100], 100, [34, 33, 33]],
    ["ties go to the earlier part", [-1, -1], 1, [1, 0]],
    ["the larger remainder wins over the earlier part", [-1, -2], 1, [0, 1]],
    ["all at zero: evenly", [0, 0, 0], 5, [2, 2, 1]],
    ["nothing moved", [-500, -700], 0, [0, 0]],
    ["one part takes it all", [-123_456], 7_890, [7_890]],
    ["no parts", [], 100, []],
    // Past what floats hold exactly: 99,999,999,999 x 99,999,999,999.
    ["huge figures", [-99_999_999_999, -1], 99_999_999_999, [99_999_999_998, 1]],
  ])("%s", (_name, balances, moved, expected) => {
    const shares = shareOverParts(balances, moved);
    expect(shares).toEqual(expected);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(balances.length === 0 ? 0 : moved);
  });
});

describe("blendedAprBps", () => {
  it.each([
    ["weighted by balance", [{ balanceCents: -300_000, aprBps: 400 }, { balanceCents: -100_000, aprBps: 800 }], 500],
    ["rounded to a basis point", [{ balanceCents: -2, aprBps: 100 }, { balanceCents: -1, aprBps: 200 }], 133],
    ["parts without a rate are left out", [{ balanceCents: -100, aprBps: 650 }, { balanceCents: -900, aprBps: null }], 650],
    ["none has a rate", [{ balanceCents: -100, aprBps: null }], null],
    ["all at zero: the plain average", [{ balanceCents: 0, aprBps: 300 }, { balanceCents: 0, aprBps: 500 }], 400],
  ])("%s", (_name, parts, expected) => {
    expect(blendedAprBps(parts)).toBe(expected);
  });
});

describe("partsInterestCents", () => {
  it("adds each part's at its own rate, leaving out those without one", () => {
    expect(
      partsInterestCents([
        { estimateCents: -1_200_000, aprBps: 600 },
        { estimateCents: -600_000, aprBps: 300 },
        { estimateCents: -500_000, aprBps: null },
      ]),
    ).toBe(6_000 + 1_500);
    expect(partsInterestCents([{ estimateCents: -500_000, aprBps: null }])).toBeNull();
  });
});

describe("a check's input", () => {
  const part = (name: string, balanceCents: number) => ({ name, balanceCents });
  const issues = (input: unknown) => {
    const result = balanceCheckInputSchema.safeParse(input);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  };

  it.each([
    ["a balance", { balanceCents: -100 }, {}],
    ["parts", { parts: [part("A", -100), part("B", -200)] }, {}],
    ["a balance and no parts", { balanceCents: -100, parts: [] }, {}],
    ["neither", {}, { balanceCents: "Enter an amount" }],
    ["no parts and no balance", { parts: [] }, { balanceCents: "Enter an amount" }],
    ["both", { balanceCents: -300, parts: [part("A", -300)] }, { balanceCents: "Leave the total out: it is the parts added up" }],
    ["a rate for the whole with parts", { aprBps: 500, parts: [part("A", -300)] }, { aprBps: "Give each part its own rate" }],
    ["two parts named alike", { parts: [part("Loan 1", -1), part("loan 1", -2)] }, { "parts.1.name": "Another part has this name" }],
    ["an empty name", { parts: [part("  ", -1)] }, { "parts.0.name": "Give it a name" }],
    ["owed and in it at once", { parts: [part("A", -1), part("B", 2)] }, { parts: "Every part is owed, or every part is in it" }],
  ])("%s", (_name, input, expected) => {
    expect(issues(input)).toEqual(expected);
  });
});
