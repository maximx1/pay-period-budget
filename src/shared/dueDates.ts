import { type LocalDate, formatMonthDay } from "./dates.ts";
import {
  describeRecurrence,
  neighbouringOccurrences,
  nextOccurrence,
  occurrencesBetween,
  type Recurrence,
} from "./recurrence.ts";

// When a bill is normally due, apart from when its payment is scheduled. See "Due dates" in
// docs/plan/domain.md.

export const DUE_UNITS = ["week", "month", "year"] as const;
export type DueUnit = (typeof DUE_UNITS)[number];

export type DueRule = {
  unit: DueUnit;
  /** Every `interval` units. */
  interval: number;
  /** A day it is due; it repeats from there and fixes the weekday, day of month or date. */
  date: LocalDate;
  /** The item's end date: nothing is due after it. */
  endDate: LocalDate | null;
};

/** The rule in words: "Due every month on the 20th". */
export function describeDue({ unit, interval, date }: DueRule): string {
  const text = describeRecurrence({ unit, interval, firstDueDate: date, endDate: null });
  return `Due ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The first day it is due on or after `onOrAfter`, or null once the item has ended. */
export function nextDueOn(rule: DueRule, onOrAfter: LocalDate): LocalDate | null {
  return nextOccurrence(toRecurrence(rule), onOrAfter);
}

/**
 * The due dates either side of a payment on `date`: the last one before it, which a late
 * payment pays, and the first on or after it, which an ordinary one pays. Either is null
 * when there is none (before the first, or after the item ends).
 */
export function dueDatesAround(rule: DueRule, date: LocalDate): { before: LocalDate | null; next: LocalDate | null } {
  const next = nextOccurrence({ ...toRecurrence(rule), endDate: null }, date) ?? date;
  const { previous } = neighbouringOccurrences(rule.unit, rule.interval, rule.date, next);
  const ended = (day: LocalDate) => rule.endDate !== null && day > rule.endDate;
  return {
    before: previous < rule.date || ended(previous) ? null : previous,
    next: ended(next) ? null : next,
  };
}

const toRecurrence =({ unit, interval, date, endDate }: DueRule): Recurrence => ({
  unit,
  interval,
  firstDueDate: date,
  endDate,
});

/** One day a bill is due, with the cycle around it that decides whether it is covered. */
export type DueCheck = {
  dueDate: LocalDate;
  /** The day it was due before this; one step back even for the first. A payment must come after it. */
  previous: LocalDate;
  /** The day it is due next. A payment after `dueDate` and before this is a late one. */
  next: LocalDate;
};

/** The days it is due from `from` through `to`, each with its cycle. */
export function dueChecksBetween(rule: DueRule, from: LocalDate, to: LocalDate): DueCheck[] {
  return occurrencesBetween(toRecurrence(rule), from, to, from).map((dueDate) => ({
    dueDate,
    ...neighbouringOccurrences(rule.unit, rule.interval, rule.date, dueDate),
  }));
}

/**
 * A day a bill is due that nothing is set to pay by then. `lateDate` is the first payment
 * toward it after that day and before the next due date, or null when there is none either.
 */
export type DueNotice = {
  billIncomeId: string;
  name: string;
  dueDate: LocalDate;
  lateDate: LocalDate | null;
};

/**
 * One of the item's transactions in its own direction (money out for a bill or a
 * transfer); the amount does not matter. `late` when the user marked it a late payment for
 * the due date before it.
 */
export type DuePayment = { date: LocalDate; late: boolean };

/**
 * Whether a due date is covered: some payment toward the item, paid or upcoming, dated
 * after the due date before it and on or before this one, and not marked late (a late one
 * paid the due date before it). Null when it is covered.
 */
export function uncoveredDue(
  check: DueCheck,
  payments: DuePayment[],
): Pick<DueNotice, "dueDate" | "lateDate"> | null {
  if (payments.some(({ date, late }) => !late && check.previous < date && date <= check.dueDate)) return null;
  const late = payments
    .map(({ date }) => date)
    .filter((date) => check.dueDate < date && date < check.next)
    .sort();
  return { dueDate: check.dueDate, lateDate: late[0] ?? null };
}

/** What to tell the user about a due date nothing is set to pay. Past tense once it has passed. */
export function dueNoticeMessage({ name, dueDate, lateDate }: DueNotice, today: LocalDate): string {
  const due = formatMonthDay(dueDate);
  const passed = dueDate < today;
  if (lateDate === null) {
    return passed
      ? `${name} was due ${due}, and nothing was set to pay it by then.`
      : `${name} is due ${due}, and nothing is set to pay it by then.`;
  }
  return passed
    ? `${name} was due ${due}, but its payment was dated ${formatMonthDay(lateDate)}.`
    : `${name} is due ${due}, but its payment is set for ${formatMonthDay(lateDate)}.`;
}
