import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import { describeRecurrence, nextOccurrence, occurrencesBetween, type Recurrence } from "./recurrence.ts";
import { nominalPeriod, type Schedule } from "./schedule.ts";

const rule = (overrides: Partial<Recurrence>): Recurrence => ({
  unit: "month",
  interval: 1,
  firstDueDate: "2026-01-25",
  endDate: null,
  ...overrides,
});

const between = (r: Recurrence, from: string, to: string) => occurrencesBetween(r, from, to, from);

describe("occurrencesBetween: monthly", () => {
  const the25th = rule({});

  it("finds the 25th in a biweekly period that contains it", () => {
    expect(between(the25th, "2026-01-13", "2026-01-26")).toEqual(["2026-01-25"]);
  });

  it("finds nothing in a biweekly period that doesn't", () => {
    expect(between(the25th, "2026-01-27", "2026-02-09")).toEqual([]);
  });

  it("finds exactly one in a monthly period", () => {
    expect(between(the25th, "2026-03-01", "2026-03-31")).toEqual(["2026-03-25"]);
    expect(between(the25th, "2026-03-15", "2026-04-14")).toEqual(["2026-03-25"]);
  });

  it("includes occurrences on both ends of the range", () => {
    expect(between(the25th, "2026-02-25", "2026-03-25")).toEqual(["2026-02-25", "2026-03-25"]);
  });

  it("falls back to the last day of short months, without drifting", () => {
    const the31st = rule({ firstDueDate: "2026-01-31" });
    expect(between(the31st, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(between(rule({ firstDueDate: "2028-01-31" }), "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("supports every third month", () => {
    const quarterly = rule({ firstDueDate: "2026-01-01", interval: 3 });
    expect(between(quarterly, "2026-01-01", "2026-12-31")).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
    expect(between(quarterly, "2026-02-01", "2026-03-31")).toEqual([]);
  });

  it("yields one occurrence per month over many years, wherever the range starts", () => {
    const the30th = rule({ firstDueDate: "2026-01-30" });
    const all = between(the30th, "2026-01-01", "2036-12-31");
    expect(all.length).toBe(11 * 12);
    expect(new Set(all.map((d) => d.slice(0, 7))).size).toBe(all.length);
    // Asking for a late slice gives the same dates as slicing the full list.
    expect(between(the30th, "2033-02-01", "2033-06-30")).toEqual(all.filter((d) => d >= "2033-02-01" && d <= "2033-06-30"));
  });
});

describe("occurrencesBetween: weekly", () => {
  // 2026-01-03 is a Saturday.
  const saturdays = rule({ unit: "week", interval: 2, firstDueDate: "2026-01-03" });

  it("gives exactly one per biweekly period when the two are in step", () => {
    const schedule: Schedule = { type: "biweekly", anchorDate: "2026-01-02" };
    for (let seq = 0; seq < 4; seq++) {
      const { start, end } = nominalPeriod(schedule, seq);
      expect(occurrencesBetween(saturdays, start, end, start)).toEqual([addDays("2026-01-03", seq * 14)]);
    }
  });

  it("alternates between periods when they are out of step", () => {
    const everyThreeWeeks = rule({ unit: "week", interval: 3, firstDueDate: "2026-01-03" });
    const schedule: Schedule = { type: "biweekly", anchorDate: "2026-01-02" };
    const counts = [0, 1, 2, 3, 4, 5].map((seq) => {
      const { start, end } = nominalPeriod(schedule, seq);
      return occurrencesBetween(everyThreeWeeks, start, end, start).length;
    });
    // Occurrences on Jan 3, Jan 24, Feb 14, Mar 7 across periods starting Jan 2, 16, 30, Feb 13, 27, Mar 13.
    expect(counts).toEqual([1, 1, 0, 1, 1, 0]);
  });

  it("gives four or five weekly occurrences in a month", () => {
    const fridays = rule({ unit: "week", interval: 1, firstDueDate: "2026-01-02" });
    expect(between(fridays, "2026-01-01", "2026-01-31").length).toBe(5);
    expect(between(fridays, "2026-02-01", "2026-02-28").length).toBe(4);
  });

  it("starts from the first occurrence inside a range far from the first due date", () => {
    // 2030-06-01 is 1,610 days (115 fortnights) after the first due date.
    expect(between(saturdays, "2030-06-01", "2030-06-30")).toEqual(["2030-06-01", "2030-06-15", "2030-06-29"]);
    expect(between(saturdays, "2030-06-02", "2030-06-28")).toEqual(["2030-06-15"]);
  });
});

describe("occurrencesBetween: yearly", () => {
  it("repeats on the same date each year", () => {
    const yearly = rule({ unit: "year", firstDueDate: "2026-03-15" });
    expect(between(yearly, "2026-01-01", "2028-12-31")).toEqual(["2026-03-15", "2027-03-15", "2028-03-15"]);
  });

  it("moves Feb 29 to Feb 28 outside leap years and back again", () => {
    const leapDay = rule({ unit: "year", firstDueDate: "2024-02-29" });
    expect(between(leapDay, "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("supports every second year", () => {
    const biennial = rule({ unit: "year", interval: 2, firstDueDate: "2026-06-01" });
    expect(between(biennial, "2026-01-01", "2031-12-31")).toEqual(["2026-06-01", "2028-06-01", "2030-06-01"]);
  });
});

describe("occurrencesBetween: start and end", () => {
  it("has nothing before the first due date", () => {
    const later = rule({ firstDueDate: "2026-03-25" });
    expect(between(later, "2026-01-01", "2026-03-24")).toEqual([]);
    expect(between(later, "2026-01-01", "2026-03-25")).toEqual(["2026-03-25"]);
  });

  it.each([
    ["on an occurrence", "2026-03-25", ["2026-01-25", "2026-02-25", "2026-03-25"]],
    ["the day before an occurrence", "2026-03-24", ["2026-01-25", "2026-02-25"]],
    ["after an occurrence", "2026-03-26", ["2026-01-25", "2026-02-25", "2026-03-25"]],
  ])("stops when the end date is %s", (_label, endDate, expected) => {
    expect(between(rule({ endDate }), "2026-01-01", "2026-12-31")).toEqual(expected);
  });

  it("returns nothing for an empty or reversed range", () => {
    expect(between(rule({}), "2026-01-26", "2026-01-24")).toEqual([]);
  });
});

describe("occurrencesBetween: every pay period", () => {
  const paycheck = rule({ unit: "period", firstDueDate: "2026-01-15" });
  const inPeriod = (r: Recurrence, start: string, end: string) => occurrencesBetween(r, start, end, start);

  it("occurs on the first day of the period containing the first due date", () => {
    expect(inPeriod(paycheck, "2026-01-13", "2026-01-26")).toEqual(["2026-01-13"]);
  });

  it("occurs on the first day of every later period", () => {
    expect(inPeriod(paycheck, "2026-01-27", "2026-02-09")).toEqual(["2026-01-27"]);
    expect(inPeriod(paycheck, "2027-05-04", "2027-05-17")).toEqual(["2027-05-04"]);
  });

  it("does not occur in periods that ended before the first due date", () => {
    expect(inPeriod(paycheck, "2025-12-30", "2026-01-12")).toEqual([]);
    expect(inPeriod(paycheck, "2026-01-01", "2026-01-14")).toEqual([]);
  });

  it("stops with periods that start after the end date", () => {
    const ending = rule({ unit: "period", firstDueDate: "2026-01-15", endDate: "2026-01-27" });
    expect(inPeriod(ending, "2026-01-27", "2026-02-09")).toEqual(["2026-01-27"]);
    expect(inPeriod(ending, "2026-02-10", "2026-02-23")).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("returns the occurrence on or after a date", () => {
    expect(nextOccurrence(rule({}), "2026-01-01")).toBe("2026-01-25");
    expect(nextOccurrence(rule({}), "2026-01-25")).toBe("2026-01-25");
    expect(nextOccurrence(rule({}), "2026-01-26")).toBe("2026-02-25");
    expect(nextOccurrence(rule({ unit: "week", interval: 2, firstDueDate: "2026-01-03" }), "2026-01-04")).toBe("2026-01-17");
    expect(nextOccurrence(rule({ unit: "year", firstDueDate: "2024-02-29" }), "2025-01-01")).toBe("2025-02-28");
  });

  it("is null once the rule has ended, and always for pay-period rules", () => {
    expect(nextOccurrence(rule({ endDate: "2026-02-25" }), "2026-02-25")).toBe("2026-02-25");
    expect(nextOccurrence(rule({ endDate: "2026-02-25" }), "2026-02-26")).toBeNull();
    expect(nextOccurrence(rule({ unit: "period" }), "2026-01-01")).toBeNull();
  });
});

describe("describeRecurrence", () => {
  it.each([
    [rule({}), "Every month on the 25th"],
    [rule({ unit: "week", interval: 2, firstDueDate: "2026-01-03" }), "Every 2 weeks on Saturday"],
    [rule({ unit: "week", firstDueDate: "2026-01-02" }), "Every week on Friday"],
    [rule({ interval: 3, firstDueDate: "2026-01-01" }), "Every 3 months on the 1st"],
    [rule({ unit: "year", firstDueDate: "2026-03-15" }), "Every year on Mar 15"],
    [rule({ unit: "year", interval: 2, firstDueDate: "2026-03-15" }), "Every 2 years on Mar 15"],
    [rule({ unit: "period" }), "Every pay period"],
    [rule({ firstDueDate: "2026-01-31" }), "Every month on the 31st (or last day)"],
    [rule({ firstDueDate: "2026-01-29" }), "Every month on the 29th (or last day)"],
    [rule({ firstDueDate: "2026-01-02" }), "Every month on the 2nd"],
    [rule({ firstDueDate: "2026-01-03" }), "Every month on the 3rd"],
    [rule({ firstDueDate: "2026-01-11" }), "Every month on the 11th"],
    [rule({ firstDueDate: "2026-01-12" }), "Every month on the 12th"],
    [rule({ firstDueDate: "2026-01-13" }), "Every month on the 13th"],
    [rule({ firstDueDate: "2026-01-21" }), "Every month on the 21st"],
    [rule({ firstDueDate: "2026-01-22" }), "Every month on the 22nd"],
    [rule({ firstDueDate: "2026-01-23" }), "Every month on the 23rd"],
    [rule({ endDate: "2027-10-12" }), "Every month on the 25th, until Oct 12, 2027"],
    [rule({ unit: "period", endDate: "2027-10-12" }), "Every pay period, until Oct 12, 2027"],
  ])("%o reads %j", (r, expected) => {
    expect(describeRecurrence(r)).toBe(expected);
  });
});
