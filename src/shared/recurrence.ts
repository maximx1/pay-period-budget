import {
  addDays,
  addMonthsClamped,
  dayOfMonth,
  diffCalendarMonths,
  diffDays,
  formatLongDate,
  formatMonthDay,
  formatWeekday,
  type LocalDate,
} from "./dates.ts";

/**
 * "none" is an item with no schedule: nothing is ever generated from it. It exists so that
 * transactions can be tied to it as they happen (money from the odd job, say).
 */
export const RECURRENCE_UNITS = ["week", "month", "year", "period", "none"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export type Recurrence = {
  unit: RecurrenceUnit;
  /** Every `interval` units. Ignored for "period" and "none". */
  interval: number;
  /** The first occurrence; also fixes the weekday, day of month or date the rule repeats on. */
  firstDueDate: LocalDate;
  /** No occurrences after this date. */
  endDate: LocalDate | null;
};

type DateUnit = Exclude<RecurrenceUnit, "period" | "none">;

// The k-th occurrence is always computed from the first due date, never from the one before
// it, so a monthly rule on the 31st gives Jan 31, Feb 28, Mar 31 instead of sticking at 28.
function occurrenceAt(unit: DateUnit, interval: number, firstDueDate: LocalDate, k: number): LocalDate {
  if (unit === "week") return addDays(firstDueDate, k * interval * 7);
  return addMonthsClamped(firstDueDate, k * interval * (unit === "year" ? 12 : 1));
}

/** Smallest k >= 0 whose occurrence falls on or after `date`. */
function firstIndexOnOrAfter(unit: DateUnit, interval: number, firstDueDate: LocalDate, date: LocalDate): number {
  if (date <= firstDueDate) return 0;
  if (unit === "week") return Math.ceil(diffDays(firstDueDate, date) / (interval * 7));

  // Jump close using calendar months, then step: clamping can put the estimate one off.
  const monthsPerStep = interval * (unit === "year" ? 12 : 1);
  let k = Math.max(0, Math.floor(diffCalendarMonths(firstDueDate, date) / monthsPerStep) - 1);
  while (occurrenceAt(unit, interval, firstDueDate, k) < date) k += 1;
  return k;
}

/**
 * The rule's occurrence dates within `from`..`to`, inclusive.
 *
 * For unit "period", `from`..`to` must be one period and `periodStart` its first day: the
 * rule occurs once, on that first day, in the period containing the first due date and in
 * every later one (so an item first due mid-period still shows up in that period).
 */
export function occurrencesBetween(rule: Recurrence, from: LocalDate, to: LocalDate, periodStart: LocalDate): LocalDate[] {
  const { unit, interval, firstDueDate, endDate } = rule;
  if (unit === "none") return [];

  if (unit === "period") {
    const reached = to >= firstDueDate;
    const ended = endDate !== null && periodStart > endDate;
    return reached && !ended && from <= periodStart && periodStart <= to ? [periodStart] : [];
  }

  const last = endDate !== null && endDate < to ? endDate : to;
  const dates: LocalDate[] = [];
  for (let k = firstIndexOnOrAfter(unit, interval, firstDueDate, from); ; k++) {
    const date = occurrenceAt(unit, interval, firstDueDate, k);
    if (date > last) return dates;
    dates.push(date);
  }
}

/**
 * The first occurrence on or after `onOrAfter`, or null if the rule has ended. Always null
 * for "period" and "none".
 */
export function nextOccurrence(rule: Recurrence, onOrAfter: LocalDate): LocalDate | null {
  const { unit, interval, firstDueDate, endDate } = rule;
  if (unit === "period" || unit === "none") return null;

  const date = occurrenceAt(unit, interval, firstDueDate, firstIndexOnOrAfter(unit, interval, firstDueDate, onOrAfter));
  return endDate !== null && date > endDate ? null : date;
}

function ordinal(n: number): string {
  const lastTwo = n % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** The rule in words: "Every 2 weeks on Saturday", "Every month on the 25th, until Oct 12, 2027". */
export function describeRecurrence(rule: Recurrence): string {
  const { unit, interval, firstDueDate, endDate } = rule;
  if (unit === "none") return "No schedule";
  const every = (noun: string) => (interval === 1 ? `Every ${noun}` : `Every ${interval} ${noun}s`);

  let text: string;
  if (unit === "period") {
    text = "Every pay period";
  } else if (unit === "week") {
    text = `${every("week")} on ${formatWeekday(firstDueDate)}`;
  } else if (unit === "month") {
    const day = dayOfMonth(firstDueDate);
    // Days that not every month has fall back to the month's last day.
    text = `${every("month")} on the ${ordinal(day)}${day >= 29 ? " (or last day)" : ""}`;
  } else {
    text = `${every("year")} on ${formatMonthDay(firstDueDate)}`;
  }
  return endDate ? `${text}, until ${formatLongDate(endDate)}` : text;
}
