import { describe, expect, it } from "vitest";
import type { PeriodSummary } from "./budget.ts";
import { findPeriodForDate } from "./periodSearch.ts";

const periods: PeriodSummary[] = [
  { id: "a", startDate: "2026-10-09", endDate: "2026-10-22" },
  { id: "b", startDate: "2026-10-23", endDate: "2026-11-05" },
  // Starts late: the 6th is covered by nothing.
  { id: "c", startDate: "2026-11-07", endDate: "2026-11-19" },
];

describe("findPeriodForDate", () => {
  it.each([
    { date: "2026-10-09", id: "a", why: "first day of the first period" },
    { date: "2026-10-22", id: "a", why: "last day of a period" },
    { date: "2026-10-23", id: "b", why: "first day of the next" },
    { date: "2026-11-01", id: "b", why: "the middle of a period" },
    { date: "2026-11-19", id: "c", why: "last day of the last period" },
  ])("$date is in period $id ($why)", ({ date, id }) => {
    expect(findPeriodForDate(periods, date)).toEqual({ found: true, period: periods.find((period) => period.id === id) });
  });

  it.each([
    { date: "2026-10-08", message: "That's before your earliest pay period, which starts Oct 9, 2026" },
    { date: "2019-01-01", message: "That's before your earliest pay period, which starts Oct 9, 2026" },
    { date: "2026-11-20", message: "Your pay periods only go up to Nov 19, 2026 so far" },
    { date: "2031-06-30", message: "Your pay periods only go up to Nov 19, 2026 so far" },
    { date: "2026-11-06", message: "No pay period covers that date" },
  ])("$date is not found: $message", ({ date, message }) => {
    expect(findPeriodForDate(periods, date)).toEqual({ found: false, message });
  });

  it("finds nothing when there are no periods", () => {
    expect(findPeriodForDate([], "2026-10-09")).toEqual({ found: false, message: "There are no pay periods yet" });
  });
});
