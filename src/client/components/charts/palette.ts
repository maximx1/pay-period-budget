// Series colours, in the order they are handed out. The order is what keeps neighbouring
// series apart for colour-blind readers (see styles.css), so a ninth series is never given
// a made-up colour: it is folded into "Other".
export const SERIES_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
] as const;

/** For what is not a series of its own: "Uncategorised", "Not tied to a bill". */
export const NEUTRAL_COLOR = "var(--color-chart-neutral)";

/** Cents as a short axis label: $0, $950, $1.2k, $3.4M. For reading a scale, not for sums. */
export function compactCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const trim = (value: number) => (value >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1));
  const text = dollars >= 1_000_000 ? `${trim(dollars / 1_000_000)}M` : dollars >= 1_000 ? `${trim(dollars / 1_000)}k` : trim(dollars);
  return `${cents < 0 ? "-" : ""}$${text}`;
}
