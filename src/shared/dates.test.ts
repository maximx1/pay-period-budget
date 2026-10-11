import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  atStartOfDay,
  compareDates,
  dateOf,
  dayOfMonth,
  diffCalendarMonths,
  diffDays,
  formatDateRange,
  formatDay,
  formatLongDate,
  formatMonthDay,
  formatTime,
  formatWeekday,
  isLocalDate,
  isLocalDateTime,
  nowIn,
  todayIn,
} from "./dates.ts";

describe("isLocalDate", () => {
  it.each(["2026-10-10", "2024-02-29", "2026-12-31", "2026-01-01"])("accepts %s", (value) => {
    expect(isLocalDate(value)).toBe(true);
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "2025-02-29",
    "2026-00-10",
    "2026-10-00",
    "2026-1-5",
    "26-10-10",
    "2026/10/10",
    "2026-10-10T00:00",
    "",
    "today",
  ])("rejects %j", (value) => {
    expect(isLocalDate(value)).toBe(false);
  });
});

describe("isLocalDateTime", () => {
  it.each(["2026-10-05T00:00", "2026-10-05T23:59", "2024-02-29T12:30"])("accepts %s", (value) => {
    expect(isLocalDateTime(value)).toBe(true);
  });

  it.each([
    "2026-10-05",
    "2026-10-05T24:00",
    "2026-10-05T12:60",
    "2026-10-05 12:00",
    "2026-10-05T12:00:00",
    "2026-10-05T12:00Z",
    "2026-02-30T12:00",
    "2026-10-05T1:00",
  ])("rejects %j", (value) => {
    expect(isLocalDateTime(value)).toBe(false);
  });
});

describe("addDays / diffDays", () => {
  it.each([
    ["2026-10-10", 1, "2026-10-11"],
    ["2026-10-10", 0, "2026-10-10"],
    ["2026-10-10", -10, "2026-09-30"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2025-02-28", 1, "2025-03-01"],
    ["2026-01-02", 14 * 26, "2027-01-01"],
    // Across both US daylight-saving changes: still exactly one calendar day each.
    ["2026-03-07", 1, "2026-03-08"],
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-10-31", 2, "2026-11-02"],
  ])("%s + %i days = %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
    expect(diffDays(date, expected)).toBe(days);
  });
});

describe("compareDates", () => {
  it("orders dates", () => {
    expect(compareDates("2026-10-09", "2026-10-10")).toBe(-1);
    expect(compareDates("2026-10-10", "2026-10-10")).toBe(0);
    expect(compareDates("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("addMonthsClamped", () => {
  it.each([
    ["2026-01-15", 1, "2026-02-15"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2026-01-31", 2, "2026-03-31"],
    ["2026-01-31", 3, "2026-04-30"],
    ["2024-01-31", 1, "2024-02-29"],
    ["2026-01-30", 1, "2026-02-28"],
    ["2026-01-29", 1, "2026-02-28"],
    ["2026-10-10", 3, "2027-01-10"],
    ["2026-12-25", 1, "2027-01-25"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-01-10", -1, "2025-12-10"],
    ["2026-05-31", 0, "2026-05-31"],
    ["2026-01-31", 13, "2027-02-28"],
    ["2026-01-31", 25, "2028-02-29"],
  ])("%s + %i months = %s", (date, months, expected) => {
    expect(addMonthsClamped(date, months)).toBe(expected);
  });

  it("does not drift when always added to the same anchor", () => {
    const starts = [0, 1, 2, 3, 4].map((n) => addMonthsClamped("2026-01-31", n));
    expect(starts).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });
});

describe("addYearsClamped", () => {
  it.each([
    ["2026-03-15", 1, "2027-03-15"],
    ["2024-02-29", 1, "2025-02-28"],
    ["2024-02-29", 4, "2028-02-29"],
    ["2026-03-15", -2, "2024-03-15"],
  ])("%s + %i years = %s", (date, years, expected) => {
    expect(addYearsClamped(date, years)).toBe(expected);
  });
});

describe("dateOf / atStartOfDay", () => {
  it("converts between dates and date-times", () => {
    expect(dateOf("2026-10-05T18:45")).toBe("2026-10-05");
    expect(atStartOfDay("2026-10-05")).toBe("2026-10-05T00:00");
  });
});

describe("todayIn / nowIn", () => {
  it.each([
    // 04:30 UTC is still the previous evening in Chicago and already afternoon in Tokyo.
    ["2026-10-10T04:30:00Z", "America/Chicago", "2026-10-09T23:30"],
    ["2026-10-10T04:30:00Z", "Asia/Tokyo", "2026-10-10T13:30"],
    // A minute either side of Chicago midnight (UTC-5 in October).
    ["2026-10-10T04:59:00Z", "America/Chicago", "2026-10-09T23:59"],
    ["2026-10-10T05:00:00Z", "America/Chicago", "2026-10-10T00:00"],
    // A minute either side of Tokyo midnight (UTC+9).
    ["2026-10-10T14:59:00Z", "Asia/Tokyo", "2026-10-10T23:59"],
    ["2026-10-10T15:00:00Z", "Asia/Tokyo", "2026-10-11T00:00"],
    // Winter offset (UTC-6) and a year boundary.
    ["2027-01-01T05:30:00Z", "America/Chicago", "2026-12-31T23:30"],
    ["2026-06-15T12:00:00Z", "UTC", "2026-06-15T12:00"],
  ])("at %s in %s it is %s", (instant, zone, expected) => {
    const now = new Date(instant);
    expect(nowIn(zone, now)).toBe(expected);
    expect(todayIn(zone, now)).toBe(expected.slice(0, 10));
  });

  it("gives different dates for the same instant in different zones", () => {
    const now = new Date("2026-10-10T04:30:00Z");
    expect(todayIn("America/New_York", now)).toBe("2026-10-10");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-09");
  });
});

describe("formatting", () => {
  it("formats a range within one year", () => {
    expect(formatDateRange("2026-10-02", "2026-10-15")).toBe("Oct 2 – Oct 15, 2026");
  });

  it("includes both years when the range crosses a year boundary", () => {
    expect(formatDateRange("2026-12-25", "2027-01-07")).toBe("Dec 25, 2026 – Jan 7, 2027");
  });

  it("formats a single day with its weekday", () => {
    expect(formatDay("2026-10-05")).toBe("Mon, Oct 5");
    expect(formatDay("2027-01-01")).toBe("Fri, Jan 1");
  });

  it.each([
    ["2026-10-05T00:00", "12:00 AM"],
    ["2026-10-05T08:05", "8:05 AM"],
    ["2026-10-05T12:00", "12:00 PM"],
    ["2026-10-05T18:45", "6:45 PM"],
    ["2026-10-05T23:59", "11:59 PM"],
  ])("formats the time of %s as %s", (dateTime, expected) => {
    // Intl separates the time and AM/PM with a narrow no-break space in newer runtimes.
    expect(formatTime(dateTime).replace(/\s/g, " ")).toBe(expected);
  });

  it("formats the other date shapes", () => {
    expect(formatWeekday("2026-10-10")).toBe("Saturday");
    expect(formatMonthDay("2026-03-15")).toBe("Mar 15");
    expect(formatLongDate("2027-10-12")).toBe("Oct 12, 2027");
  });
});

describe("dayOfMonth / diffCalendarMonths", () => {
  it("reads the day of the month", () => {
    expect(dayOfMonth("2026-10-05")).toBe(5);
    expect(dayOfMonth("2026-10-31")).toBe(31);
  });

  it.each([
    ["2026-01-31", "2026-02-01", 1],
    ["2026-01-01", "2026-01-31", 0],
    ["2026-10-10", "2027-01-10", 3],
    ["2026-03-15", "2026-01-20", -2],
    ["2026-12-31", "2027-01-01", 1],
  ])("counts calendar months from %s to %s as %i", (from, to, expected) => {
    expect(diffCalendarMonths(from, to)).toBe(expected);
  });
});
