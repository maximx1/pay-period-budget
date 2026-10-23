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
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "Everything so far" },
  { value: "custom", label: "Between two dates" },
] as const;
export type SpanChoice = (typeof SPAN_CHOICES)[number]["value"];

/**
 * The dates a choice stands for: so many pay periods ending with the current one, all of
 * them up to it, or January 1st of today's year up to it. A report counts every period that
 * shares a day with its dates, so year to date includes the whole of a period that began in
 * December. Null for "custom" (the dates are typed) and when there are no periods.
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
  if (choice === "ytd") {
    // Past every period into a new year, that is just the latest one.
    const january1 = `${today.slice(0, 4)}-01-01`;
    const from = periods[last]!.endDate < january1 ? periods[last]!.startDate : january1;
    return { from, to: periods[last]!.endDate };
  }
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

export const STARTED_WITH = "started-with";
export const CASH_ON_HAND = "cash-on-hand";
export const ADJUSTMENTS = "adjustments";
/** The income side of the cash-flow chart, and the cash on hand, are drawn in the app's own colour. */
export const INCOME_COLOR = "var(--color-primary)";

export type FlowNode = { key: string; name: string; color: string; value: number };
export type CashFlow = {
  /** Where the money came from: income, largest first, then what the span started with. */
  sources: FlowNode[];
  /** Everything there was to spend, which is everything spent or still on hand. */
  total: { name: string; value: number };
  /** Where it went: the cash on hand first, then by category, largest first. */
  uses: FlowNode[];
};

/**
 * Money in by where it came from, against money out by category, over a span. The leftover
 * the span started with (`startedWith`, the first period's starting amount) joins the
 * sources, and what it ends with (`cashOnHand`, the last period's projected leftover) joins
 * the uses: income less spending is only what moved that leftover. Anything else that
 * moved it (a starting amount set by hand, a balance below zero) is "Adjustments", on
 * whichever side is short, so the two sides always balance. Null with no money either way.
 */
export function cashFlow(
  sourceIn: ReadonlyMap<string | null, number>,
  sources: ReturnType<typeof rankSeries>,
  categoryOut: ReadonlyMap<string | null, number>,
  categories: ReturnType<typeof rankSeries>,
  { startedWith, cashOnHand }: { startedWith: number; cashOnHand: number },
): CashFlow | null {
  const nodes = (totals: ReadonlyMap<string | null, number>, ranked: ReturnType<typeof rankSeries>) =>
    ranked.series.map(({ key, name, color }) => {
      let value = 0;
      for (const [id, cents] of totals) if (ranked.keyOf(id) === key) value += cents;
      return { key, name, color, value };
    });
  const income = nodes(sourceIn, sources).map((node) => ({ ...node, color: INCOME_COLOR }));
  const spent = nodes(categoryOut, categories);
  const inTotal = income.reduce((total, node) => total + node.value, 0);
  const outTotal = spent.reduce((total, node) => total + node.value, 0);
  if (inTotal === 0 && outTotal === 0) return null;

  const started = Math.max(0, startedWith);
  const onHand = Math.max(0, cashOnHand);
  const short = inTotal + started - (outTotal + onHand);
  const adjustments = (value: number): FlowNode => ({ key: ADJUSTMENTS, name: "Adjustments", color: NEUTRAL_COLOR, value });
  return {
    sources: [
      ...income,
      ...(started > 0 ? [{ key: STARTED_WITH, name: "Started with", color: NEUTRAL_COLOR, value: started }] : []),
      ...(short < 0 ? [adjustments(-short)] : []),
    ],
    total: { name: started > 0 ? "Income and what you started with" : "Income", value: Math.max(inTotal + started, outTotal + onHand) },
    uses: [
      ...(onHand > 0 ? [{ key: CASH_ON_HAND, name: "Cash on hand", color: INCOME_COLOR, value: onHand }] : []),
      ...spent,
      ...(short > 0 ? [adjustments(short)] : []),
    ],
  };
}
