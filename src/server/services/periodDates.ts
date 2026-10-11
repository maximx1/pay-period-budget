import { addDays, formatLongDate, type LocalDate } from "../../shared/dates.ts";

type Bounds = { seq: number; startDate: LocalDate; endDate: LocalDate };

/** A run of days that will belong to a different period. `toSeq` null means no period would hold them. */
export type DayTransfer = {
  from: LocalDate;
  to: LocalDate;
  fromSeq: number;
  toSeq: number | null;
  /** The field whose change caused it, for reporting a problem with these days. */
  field: "startDate" | "endDate";
};

export type DatePlan = {
  startDate: LocalDate;
  endDate: LocalDate;
  /** The previous period's new end date, when the shared boundary moves. */
  previousEnd: LocalDate | null;
  /** The next period's new start date, when the shared boundary moves. */
  nextStart: LocalDate | null;
  transfers: DayTransfer[];
};

export type DatePlanError = { field: "startDate" | "endDate"; message: string };

/**
 * Works out what moving a period's dates entails, or why it isn't allowed. Pure: it only
 * looks at the dates it is given.
 *
 * Periods stay contiguous, so moving a start moves the previous period's end and moving an
 * end moves the next period's start; nothing else about a neighbour changes.
 *
 * @param next the following period, or the one that will be generated after this one, or
 *   null when this is the last period the horizon allows
 * @param latestEndWithoutNext with no `next`: the latest this period may end and still
 *   leave room for the period eventually generated after it
 */
export function planDateChange(input: {
  period: Bounds;
  previous: Bounds | null;
  next: Bounds | null;
  latestEndWithoutNext: LocalDate;
  startDate?: LocalDate;
  endDate?: LocalDate;
}): DatePlan | DatePlanError {
  const { period, previous, next } = input;
  const startDate = input.startDate ?? period.startDate;
  const endDate = input.endDate ?? period.endDate;
  const startMoved = startDate !== period.startDate;
  const endMoved = endDate !== period.endDate;
  const changedField = startMoved || !endMoved ? "startDate" : "endDate";

  if (startDate > endDate) {
    return startMoved
      ? { field: "startDate", message: "Must be on or before the end date" }
      : { field: "endDate", message: "Must be on or after the start date" };
  }
  // Without this a period could jump clear of its own dates and swallow days that belonged
  // to the neighbour on the far side.
  if (startDate > period.endDate || endDate < period.startDate) {
    return { field: changedField, message: "Keep at least one of the period's current days" };
  }

  const transfers: DayTransfer[] = [];

  if (startMoved) {
    if (previous) {
      const earliest = addDays(previous.startDate, 1);
      if (startDate < earliest) {
        return {
          field: "startDate",
          message: `Can't be earlier than ${formatLongDate(earliest)}, the day after the previous period starts`,
        };
      }
    }
    if (startDate < period.startDate) {
      // Days gained from the previous period. With no previous period nothing can be dated there.
      if (previous) {
        transfers.push({ from: startDate, to: addDays(period.startDate, -1), fromSeq: previous.seq, toSeq: period.seq, field: "startDate" });
      }
    } else {
      transfers.push({ from: period.startDate, to: addDays(startDate, -1), fromSeq: period.seq, toSeq: previous?.seq ?? null, field: "startDate" });
    }
  }

  if (endMoved) {
    const latest = next ? addDays(next.endDate, -1) : input.latestEndWithoutNext;
    if (endDate > latest) {
      return {
        field: "endDate",
        message: next
          ? `Can't be later than ${formatLongDate(latest)}, the day before the next period ends`
          : `Can't be later than ${formatLongDate(latest)}`,
      };
    }
    if (endDate > period.endDate) {
      // Days gained from the next period. With no next period nothing can be dated there.
      if (next) {
        transfers.push({ from: addDays(period.endDate, 1), to: endDate, fromSeq: next.seq, toSeq: period.seq, field: "endDate" });
      }
    } else {
      transfers.push({ from: addDays(endDate, 1), to: period.endDate, fromSeq: period.seq, toSeq: next?.seq ?? null, field: "endDate" });
    }
  }

  return {
    startDate,
    endDate,
    previousEnd: startMoved && previous ? addDays(startDate, -1) : null,
    nextStart: endMoved && next ? addDays(endDate, 1) : null,
    transfers,
  };
}
