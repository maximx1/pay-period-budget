import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import { earliestSeq, horizonSeq, nominalPeriod, nominalStart, type Schedule, SCHEDULE_TYPES, seqForDate } from "./schedule.ts";

const weekly: Schedule = { type: "weekly", anchorDate: "2026-01-02" };
const biweekly: Schedule = { type: "biweekly", anchorDate: "2026-01-02" };
const monthly: Schedule = { type: "monthly", anchorDate: "2026-01-15" };
const monthEnd: Schedule = { type: "monthly", anchorDate: "2026-01-31" };

describe("nominalPeriod", () => {
  it.each([
    [weekly, 0, "2026-01-02", "2026-01-08"],
    [weekly, 1, "2026-01-09", "2026-01-15"],
    [weekly, 2, "2026-01-16", "2026-01-22"],
    [weekly, 520, "2035-12-21", "2035-12-27"],
    [biweekly, 0, "2026-01-02", "2026-01-15"],
    [biweekly, 1, "2026-01-16", "2026-01-29"],
    [biweekly, 2, "2026-01-30", "2026-02-12"],
    [biweekly, 26, "2027-01-01", "2027-01-14"],
    [biweekly, 260, "2035-12-21", "2036-01-03"],
    [monthly, 0, "2026-01-15", "2026-02-14"],
    [monthly, 1, "2026-02-15", "2026-03-14"],
    [monthly, 2, "2026-03-15", "2026-04-14"],
    [monthly, 11, "2026-12-15", "2027-01-14"],
    [monthly, 120, "2036-01-15", "2036-02-14"],
  ])("%o #%i runs %s to %s", (schedule, seq, start, end) => {
    expect(nominalPeriod(schedule, seq)).toEqual({ start, end });
  });

  it.each(SCHEDULE_TYPES)("%s periods follow one another with no gap or overlap", (type) => {
    for (const anchorDate of ["2026-01-02", "2026-01-29", "2026-01-30", "2026-01-31", "2024-02-29"]) {
      const schedule: Schedule = { type, anchorDate };
      for (let seq = 0; seq < 60; seq++) {
        const current = nominalPeriod(schedule, seq);
        expect(current.end >= current.start).toBe(true);
        expect(nominalStart(schedule, seq + 1)).toBe(addDays(current.end, 1));
      }
    }
  });
});

describe("monthly schedules anchored late in the month", () => {
  it.each([
    // non-leap February
    ["2026-01-29", ["2026-01-29", "2026-02-28", "2026-03-29", "2026-04-29"]],
    ["2026-01-30", ["2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30"]],
    ["2026-01-31", ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]],
    // leap February
    ["2028-01-29", ["2028-01-29", "2028-02-29", "2028-03-29", "2028-04-29"]],
    ["2028-01-30", ["2028-01-30", "2028-02-29", "2028-03-30", "2028-04-30"]],
    ["2028-01-31", ["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]],
  ])("anchor %s starts on %j", (anchorDate, starts) => {
    const schedule: Schedule = { type: "monthly", anchorDate };
    expect([0, 1, 2, 3].map((seq) => nominalStart(schedule, seq))).toEqual(starts);
  });

  it("ends the January period the day before the clamped February start", () => {
    expect(nominalPeriod({ type: "monthly", anchorDate: "2026-01-31" }, 0)).toEqual({
      start: "2026-01-31",
      end: "2026-02-27",
    });
  });
});

describe("seqForDate", () => {
  it.each([
    [weekly, "2026-01-02", 0],
    [weekly, "2026-01-08", 0],
    [weekly, "2026-01-09", 1],
    [biweekly, "2026-01-02", 0],
    [biweekly, "2026-01-15", 0],
    [biweekly, "2026-01-16", 1],
    [biweekly, "2027-01-01", 26],
    [monthly, "2026-01-15", 0],
    [monthly, "2026-02-14", 0],
    [monthly, "2026-02-15", 1],
    [monthly, "2027-01-14", 11],
    [monthly, "2027-01-15", 12],
  ])("%o puts %s in period %i", (schedule, date, seq) => {
    expect(seqForDate(schedule, date)).toBe(seq);
  });

  it.each(SCHEDULE_TYPES)("agrees with nominalPeriod for every day of two years (%s)", (type) => {
    for (const anchorDate of ["2026-01-02", "2026-01-31", "2027-08-30"]) {
      const schedule: Schedule = { type, anchorDate };
      for (let offset = 0; offset < 731; offset++) {
        const date = addDays(anchorDate, offset);
        const { start, end } = nominalPeriod(schedule, seqForDate(schedule, date));
        expect(start <= date && date <= end, `${type} from ${anchorDate}: ${date} not in ${start}..${end}`).toBe(true);
      }
    }
  });

  it("numbers the periods before the anchor downwards from -1", () => {
    for (const schedule of [weekly, biweekly, monthly, monthEnd]) {
      for (let seq = -1; seq >= -30; seq -= 1) {
        const { start, end } = nominalPeriod(schedule, seq);
        expect(seqForDate(schedule, start), `${schedule.type} ${seq} start`).toBe(seq);
        expect(seqForDate(schedule, end), `${schedule.type} ${seq} end`).toBe(seq);
        // Back to back with the period after it.
        expect(addDays(end, 1)).toBe(nominalPeriod(schedule, seq + 1).start);
      }
    }
  });
});

describe("earliestSeq", () => {
  it.each([
    // today 2026-01-15, so the earliest period is the one containing 2025-01-15
    [weekly, -51],
    [biweekly, -26],
    [monthly, -12],
  ])("%o allows adding back to period %i", (schedule, expected) => {
    const seq = earliestSeq(schedule, "2026-01-15");
    expect(seq).toBe(expected);
    const { start, end } = nominalPeriod(schedule, seq);
    expect(start <= "2025-01-15" && "2025-01-15" <= end).toBe(true);
  });
});

describe("horizonSeq", () => {
  it.each([
    // today 2026-01-15, so the horizon period is the one containing 2027-01-15
    [weekly, 54],
    [biweekly, 27],
    [monthly, 12],
  ])("%o allows generating through period %i", (schedule, expected) => {
    const seq = horizonSeq(schedule, "2026-01-15");
    expect(seq).toBe(expected);
    const { start, end } = nominalPeriod(schedule, seq);
    expect(start <= "2027-01-15" && "2027-01-15" <= end).toBe(true);
  });

  it("clamps a leap-day today to Feb 28 of the next year", () => {
    const schedule: Schedule = { type: "weekly", anchorDate: "2024-02-29" };
    expect(horizonSeq(schedule, "2024-02-29")).toBe(seqForDate(schedule, "2025-02-28"));
  });
});
