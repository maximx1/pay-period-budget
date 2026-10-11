import { describe, expect, it } from "vitest";
import { formatCents, parseMoneyInput } from "./money.ts";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [2700, "$27.00"],
    [-2700, "-$27.00"],
    [150000, "$1,500.00"],
    [-123456789, "-$1,234,567.89"],
  ])("formats %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("adds a plus sign to positive amounts only when asked", () => {
    expect(formatCents(150000, { showPlus: true })).toBe("+$1,500.00");
    expect(formatCents(-2700, { showPlus: true })).toBe("-$27.00");
    expect(formatCents(0, { showPlus: true })).toBe("$0.00");
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["27", 2700],
    ["27.5", 2750],
    ["27.50", 2750],
    ["27.", 2700],
    [".5", 50],
    ["0.07", 7],
    ["1,234.56", 123456],
    ["$5", 500],
    [" $ 1,000 ", 100000],
    ["0", 0],
    // Values that binary floating point can't represent exactly.
    ["0.29", 29],
    ["1.15", 115],
    ["4.35", 435],
    ["19.99", 1999],
  ])("parses %j as %i cents", (text, expected) => {
    expect(parseMoneyInput(text)).toBe(expected);
  });

  it.each(["", "   ", ".", "$", "-5", "+5", "abc", "1.234", "1.2.3", "12a", "1e3", "5 5", "99999999999999999999"])(
    "rejects %j",
    (text) => {
      expect(parseMoneyInput(text)).toBeNull();
    },
  );

  it.each([
    ["-40", -4000],
    ["-$40.50", -4050],
    [" - 1,000 ", -100000],
    ["-0", 0],
    ["25", 2500],
  ])("parses %j as %i cents when negatives are allowed", (text, expected) => {
    expect(parseMoneyInput(text, { allowNegative: true })).toBe(expected);
  });

  it.each(["--5", "-", "-abc", "5-"])("still rejects %j when negatives are allowed", (text) => {
    expect(parseMoneyInput(text, { allowNegative: true })).toBeNull();
  });
});
