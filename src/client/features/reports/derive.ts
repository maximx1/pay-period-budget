import type { PeriodSummary } from "../../../shared/budget.ts";
import type { LocalDate } from "../../../shared/dates.ts";
import { NEUTRAL_COLOR, SERIES_COLORS } from "../../components/charts/palette.ts";

// The working-out behind the Reports page that is worth testing by itself: which pay
// periods a choice of span means, and which colour each category or bill is drawn in.

export const SPAN_CHOICES = [
  { value: "3", label: "Last 3 pay periods" },
  { value: "6", label: "Last 6 pay periods" },
  { value: "12", label: "Last 12 pay periods" },
  { value: "26", label: "Last 26 pay periods" },
  { value: "all", label: "Everything so far" },
  { value: "custom", label: "Between two dates" },
] as const;
export type SpanChoice = (typeof SPAN_CHOICES)[number]["value"];

/**
 * The dates a choice stands for: so many pay periods ending with the current one, or all
 * of them up to it. Null for "custom" (the dates are typed) and when there are no periods.
 */
export function spanFor(
  choice: SpanChoice,
  periods: readonly PeriodSummary[],
  today: LocalDate,
): { from: LocalDate; to: LocalDate } | null {
  if (choice === "custom" || periods.length === 0) return null;
  // The current period, or failing that the latest one that has begun.
  let last = periods.findIndex((period) => period.startDate <= today && today <= period.endDate);
  if (last === -1) last = periods.findLastIndex((period) => period.startDate <= today);
  if (last === -1) last = 0;
  const first = choice === "all" ? 0 : Math.max(0, last - Number(choice) + 1);
  return { from: periods[first]!.startDate, to: periods[last]!.endDate };
}

export const OTHER = "other";
export const NONE = "none";

export type RankedSeries = { key: string; name: string; color: string };

/**
 * Gives each thing a colour for the whole page: the seven with the most money get a
 * colour of their own, largest first; the rest share "Other"; and what belongs to nothing
 * (`null`) is grey under `noneLabel`. Things with no money are left out. A colour follows
 * the thing, so the same category is the same colour in every chart.
 */
export function rankSeries(
  totals: ReadonlyMap<string | null, number>,
  nameOf: (id: string) => string | undefined,
  noneLabel: string,
): { series: RankedSeries[]; keyOf: (id: string | null) => string } {
  const named = [...totals]
    .filter((entry): entry is [string, number] => entry[0] !== null && entry[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const own = named.slice(0, SERIES_COLORS.length - 1);
  const series: RankedSeries[] = own.map(([id], index) => ({
    key: id,
    name: nameOf(id) ?? "Deleted",
    color: SERIES_COLORS[index]!,
  }));
  if (named.length > own.length) series.push({ key: OTHER, name: "Other", color: SERIES_COLORS.at(-1)! });
  if ((totals.get(null) ?? 0) > 0) series.push({ key: NONE, name: noneLabel, color: NEUTRAL_COLOR });

  const ownKeys = new Set(own.map(([id]) => id));
  return { series, keyOf: (id) => (id === null ? NONE : ownKeys.has(id) ? id : OTHER) };
}

/** Adds `amount` under `key`. */
export function addTo<K>(totals: Map<K, number>, key: K, amount: number): void {
  totals.set(key, (totals.get(key) ?? 0) + amount);
}

/** The mean in whole cents; 0 of nothing. */
export const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
