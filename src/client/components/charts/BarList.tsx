import { TriangleAlert } from "lucide-react";

export type BarRow = {
  name: string;
  /** How long the bar is, against `of` or against the longest row. */
  value: number;
  /** The text at the end of the row. */
  text: string;
  /** A second line under the name. */
  detail?: string;
  /** What the bar is measured against, when each row has its own: a limit. Past it, the row is flagged. */
  of?: number;
  color?: string;
};

/**
 * A ranked list with a bar under each row: for names rather than dates along the side,
 * where the labels are too long to sit under columns.
 */
export function BarList({ rows, empty = "Nothing to show for this span." }: { rows: readonly BarRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const longest = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const against = row.of ?? longest;
        const over = row.of !== undefined && row.value > row.of;
        const share = against === 0 ? (row.value > 0 ? 1 : 0) : Math.min(1, row.value / against);
        return (
          <li key={`${row.name}-${index}`} className="min-w-0">
            <div className="flex items-baseline gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg">{row.name}</span>
              <span className="flex shrink-0 items-center gap-1 font-medium text-fg tabular-nums">
                {over && <TriangleAlert className="size-3.5 text-warning" role="img" aria-label="Over the limit" />}
                {row.text}
              </span>
            </div>
            {row.detail && <p className="truncate text-xs text-muted">{row.detail}</p>}
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${share * 100}%`, backgroundColor: over ? "var(--color-warning)" : (row.color ?? "var(--color-chart-1)") }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
