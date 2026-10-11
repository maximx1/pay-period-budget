import type { PeriodSummary } from "./budget.ts";
import { formatLongDate, type LocalDate } from "./dates.ts";

/** Where a date falls among the periods that exist. */
export type PeriodSearchResult =
  | { found: true; period: PeriodSummary }
  | { found: false; message: string };

/**
 * The existing period that covers `date`. Searching never creates a period, so a date
 * outside what the budget covers so far is an error that says how far it does go.
 * `periods` is oldest first, as the API returns it.
 */
export function findPeriodForDate(periods: readonly PeriodSummary[], date: LocalDate): PeriodSearchResult {
  const first = periods[0];
  const last = periods.at(-1);
  if (!first || !last) return { found: false, message: "There are no pay periods yet" };

  if (date < first.startDate) {
    return { found: false, message: `That's before your earliest pay period, which starts ${formatLongDate(first.startDate)}` };
  }
  if (date > last.endDate) {
    return { found: false, message: `Your pay periods only go up to ${formatLongDate(last.endDate)} so far` };
  }
  const period = periods.find((candidate) => candidate.startDate <= date && date <= candidate.endDate);
  return period ? { found: true, period } : { found: false, message: "No pay period covers that date" };
}
