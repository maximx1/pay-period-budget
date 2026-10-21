import { describe, expect, it } from "vitest";
import {
  type BalanceLevel,
  balanceLevel,
  type BalanceOutlook,
  type OutlookPeriod,
  outlookHeading,
  outlookLine,
} from "./outlook.ts";

describe("balanceLevel", () => {
  it.each<[number, number, BalanceLevel]>([
    [20_000, 20_000, "ok"],
    [19_999, 20_000, "low"],
    [0, 20_000, "low"],
    [-1, 20_000, "negative"],
    [0, 0, "ok"],
    [-1, 0, "negative"],
    [1_000_000, 20_000, "ok"],
  ])("%i against %i is %s", (cents, low, level) => {
    expect(balanceLevel(cents, low)).toBe(level);
  });
});

const period = (startDate: string, endDate: string, projectedCents: number, level: BalanceLevel): OutlookPeriod => ({
  periodId: `period-${startDate}`,
  startDate,
  endDate,
  projectedCents,
  level,
});

describe("outlookHeading", () => {
  const outlook = (periods: OutlookPeriod[]): BalanceOutlook => ({
    settings: { lowBalanceCents: 20_000, periodsAhead: 5 },
    periods,
  });

  it.each<[string, OutlookPeriod[], string | null, string | null]>([
    ["nothing to warn about", [period("2026-02-01", "2026-02-14", 50_000, "ok")], null, null],
    [
      "one of each",
      [period("2026-02-01", "2026-02-14", 15_000, "low"), period("2026-02-15", "2026-02-28", -100, "negative")],
      "A coming pay period is set to end below zero.",
      "A coming pay period is set to end below $200.00.",
    ],
    [
      "several below zero",
      [period("2026-02-01", "2026-02-14", -1, "negative"), period("2026-02-15", "2026-02-28", -100, "negative")],
      "2 coming pay periods are set to end below zero.",
      null,
    ],
  ])("%s", (_, periods, negative, low) => {
    expect(outlookHeading(outlook(periods), "negative")).toBe(negative);
    expect(outlookHeading(outlook(periods), "low")).toBe(low);
  });
});

describe("outlookLine", () => {
  it("names the dates and the balance", () => {
    expect(outlookLine(period("2026-12-25", "2027-01-07", -31_055, "negative"))).toBe(
      "Dec 25, 2026 – Jan 7, 2027: ends with -$310.55",
    );
  });
});
