import { addDays, addMonthsClamped, addYearsClamped, diffDays, type LocalDate } from "./dates.ts";

// Listed in the order the setup screen offers them; the first is the default.
export const SCHEDULE_TYPES = ["biweekly", "weekly", "monthly"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export type Schedule = { type: ScheduleType; anchorDate: LocalDate };

const DAYS_PER_PERIOD = { weekly: 7, biweekly: 14 } as const;

/**
 * First day of the schedule's `seq`-th period, before any manual adjustment. Period 0 starts
 * on the anchor; negative numbers are the periods before the budget began.
 */
export function nominalStart(schedule: Schedule, seq: number): LocalDate {
  // Months are always added to the anchor, never to the previous start, so an anchor on
  // the 31st gives Jan 31, Feb 28, Mar 31 instead of drifting to the 28th.
  if (schedule.type === "monthly") return addMonthsClamped(schedule.anchorDate, seq);
  return addDays(schedule.anchorDate, seq * DAYS_PER_PERIOD[schedule.type]);
}

/** The `seq`-th period as scheduled: its start through the day before the next start. */
export function nominalPeriod(schedule: Schedule, seq: number): { start: LocalDate; end: LocalDate } {
  return { start: nominalStart(schedule, seq), end: addDays(nominalStart(schedule, seq + 1), -1) };
}

/** Index of the nominal period containing `date`; negative for a date before the anchor. */
export function seqForDate(schedule: Schedule, date: LocalDate): number {
  if (schedule.type !== "monthly") {
    return Math.floor(diffDays(schedule.anchorDate, date) / DAYS_PER_PERIOD[schedule.type]);
  }

  // Month lengths vary and starts can be clamped, so estimate from the calendar-month
  // difference and then step to the period that actually contains the date.
  const [anchorYear, anchorMonth] = schedule.anchorDate.split("-").map(Number) as [number, number];
  const [year, month] = date.split("-").map(Number) as [number, number];
  let seq = (year - anchorYear) * 12 + (month - anchorMonth);
  while (nominalStart(schedule, seq) > date) seq -= 1;
  while (nominalStart(schedule, seq + 1) <= date) seq += 1;
  return seq;
}

/** The furthest period that may be generated: the one containing the day a year from `today`. */
export function horizonSeq(schedule: Schedule, today: LocalDate): number {
  return seqForDate(schedule, addYearsClamped(today, 1));
}

/** How far before today pay periods may be added, to hold history from before the budget began. */
export const MAX_HISTORY_YEARS = 5;

/** The earliest period that may be added: the one containing the day MAX_HISTORY_YEARS before `today`. */
export function earliestSeq(schedule: Schedule, today: LocalDate): number {
  return seqForDate(schedule, addYearsClamped(today, -MAX_HISTORY_YEARS));
}
