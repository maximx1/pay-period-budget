// Calendar arithmetic on plain strings. Everything here works in UTC internally so the
// machine's own time zone can never shift a date; the only functions that involve a real
// time zone are todayIn / nowIn, which take it explicitly.

/** A calendar date, "YYYY-MM-DD". */
export type LocalDate = string;
/** A wall-clock date and time with no zone, "YYYY-MM-DDTHH:mm". */
export type LocalDateTime = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

function fromParts(year: number, monthIndex: number, day: number): LocalDate {
  return fromUtc(new Date(Date.UTC(year, monthIndex, day)));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** True for a correctly formatted date that exists on the calendar ("2026-02-30" does not). */
export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_RE.test(value)) return false;
  const parsed = toUtc(value);
  return !Number.isNaN(parsed.getTime()) && fromUtc(parsed) === value;
}

export function isLocalDateTime(value: string): value is LocalDateTime {
  return value.length === 16 && value[10] === "T" && isLocalDate(value.slice(0, 10)) && TIME_RE.test(value.slice(11));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

export function compareDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adds calendar months, keeping the day of month where it exists and otherwise using the month's last day. */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const source = toUtc(date);
  const total = source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  return fromParts(year, monthIndex, Math.min(source.getUTCDate(), daysInMonth(year, monthIndex)));
}

/** Adds calendar years; Feb 29 becomes Feb 28 in a non-leap year. */
export function addYearsClamped(date: LocalDate, years: number): LocalDate {
  return addMonthsClamped(date, years * 12);
}

export function dateOf(dateTime: LocalDateTime): LocalDate {
  return dateTime.slice(0, 10);
}

export function atStartOfDay(date: LocalDate): LocalDateTime {
  return `${date}T00:00`;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockParts(timeZone: string, now: Date): Record<string, string> {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) parts[part.type] = part.value;
  return parts;
}

/** The calendar date it is at instant `now` in the IANA zone `timeZone`. */
export function todayIn(timeZone: string, now: Date): LocalDate {
  const { year, month, day } = wallClockParts(timeZone, now);
  return `${year}-${month}-${day}`;
}

/** The wall-clock date and time at instant `now` in the IANA zone `timeZone`. */
export function nowIn(timeZone: string, now: Date): LocalDateTime {
  const { year, month, day, hour, minute } = wallClockParts(timeZone, now);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const weekdayMonthDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Oct 2 – Oct 15, 2026", or "Dec 25, 2026 – Jan 7, 2027" across a year boundary. */
export function formatDateRange(start: LocalDate, end: LocalDate): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startText = (sameYear ? monthDay : monthDayYear).format(toUtc(start));
  return `${startText} – ${monthDayYear.format(toUtc(end))}`;
}

/** "Mon, Oct 5" */
export function formatDay(date: LocalDate): string {
  return weekdayMonthDay.format(toUtc(date));
}

const hourMinute = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });

/** The time part of a date-time for display: "6:45 PM". */
export function formatTime(dateTime: LocalDateTime): string {
  return hourMinute.format(new Date(`${dateTime}:00Z`));
}

const weekdayLong = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });

/** "Saturday" */
export function formatWeekday(date: LocalDate): string {
  return weekdayLong.format(toUtc(date));
}

/** "Mar 15" */
export function formatMonthDay(date: LocalDate): string {
  return monthDay.format(toUtc(date));
}

/** "Oct 12, 2027" */
export function formatLongDate(date: LocalDate): string {
  return monthDayYear.format(toUtc(date));
}

/** Day of the month, 1 to 31. */
export function dayOfMonth(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

/** Whole calendar months from `from` to `to`, ignoring the day: Jan 31 to Feb 1 is 1. */
export function diffCalendarMonths(from: LocalDate, to: LocalDate): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}
