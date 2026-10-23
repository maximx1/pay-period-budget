import { diffDays, type LocalDate, formatMonthDay } from "./dates.ts";
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

/** How many days ahead a due date counts as soon: from then through the day itself it is urgent. */
export const DUE_SOON_DAYS = 3;

/**
 * Something to say about a day a bill is due: nothing is set to pay it by then (with
 * `lateDate`, the first payment toward it after that day and before the next due date, or
 * null when there is none either), or it is soon and what pays it is not marked paid yet.
 */
export type DueNotice = {
  billIncomeId: string;
  name: string;
  dueDate: LocalDate;
  lateDate: LocalDate | null;
  /**
   * Set when a payment is set to pay it but none is marked paid, and it is soon: that
   * payment's date. Absent from servers older than phase 34.
   */
  unpaidDate?: LocalDate | null;
  /** It is due within DUE_SOON_DAYS days, or today. Absent from servers older than phase 34. */
  urgent?: boolean;
};

/**
 * One of the item's transactions in its own direction (money out for a bill or a
 * transfer); the amount does not matter. `late` when the user marked it a late payment for
 * the due date before it.
 */
export type DuePayment = { date: LocalDate; late: boolean; paid: boolean };

/** Whether a due date is close enough to say so urgently: today, or within DUE_SOON_DAYS. */
export function isDueSoon(dueDate: LocalDate, today: LocalDate): boolean {
  const days = diffDays(today, dueDate);
  return days >= 0 && days <= DUE_SOON_DAYS;
}

/**
 * What to say about a due date, or null when nothing needs saying. It is covered by a
 * payment toward the item, paid or upcoming, dated after the due date before it and on or
 * before this one, and not marked late (a late one paid the due date before it). Covered
 * by something marked paid, all is well. Covered only by upcoming ones, all is well too
 * until it is soon; then it says the payment isn't marked paid yet.
 */
export function dueNoticeFor(
  check: DueCheck,
  payments: DuePayment[],
  today: LocalDate,
): Pick<DueNotice, "dueDate" | "lateDate" | "unpaidDate" | "urgent"> | null {
  const urgent = isDueSoon(check.dueDate, today);
  const covering = payments
    .filter(({ date, late }) => !late && check.previous < date && date <= check.dueDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (covering.some(({ paid }) => paid)) return null;
  if (covering.length > 0) {
    return urgent ? { dueDate: check.dueDate, lateDate: null, unpaidDate: covering[0]!.date, urgent } : null;
  }
  const late = payments
    .map(({ date }) => date)
    .filter((date) => check.dueDate < date && date < check.next)
    .sort();
  return { dueDate: check.dueDate, lateDate: late[0] ?? null, unpaidDate: null, urgent };
}

/** "today", "tomorrow" or "in 3 days". */
function howSoon(dueDate: LocalDate, today: LocalDate): string {
  const days = diffDays(today, dueDate);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/** What to tell the user about a due date. Past tense once it has passed; says how soon when it is. */
export function dueNoticeMessage({ name, dueDate, lateDate, unpaidDate }: DueNotice, today: LocalDate): string {
  const due = formatMonthDay(dueDate);
  const passed = dueDate < today;
  const when = isDueSoon(dueDate, today) ? `${due}, ${howSoon(dueDate, today)}` : due;
  if (unpaidDate) {
    return `${name} is due ${when}, and its payment on ${formatMonthDay(unpaidDate)} isn't marked paid yet.`;
  }
  if (lateDate === null) {
    return passed
      ? `${name} was due ${due}, and nothing was set to pay it by then.`
      : `${name} is due ${when}, and nothing is set to pay it by then.`;
  }
  return passed
    ? `${name} was due ${due}, but its payment was dated ${formatMonthDay(lateDate)}.`
    : `${name} is due ${when}, but its payment is set for ${formatMonthDay(lateDate)}.`;
}
