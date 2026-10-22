import { describe, expect, it } from "vitest";
import { asksFor, formatApr, monthlyInterestCents, nextCheckOn, parseAprInput } from "./balances.ts";

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
