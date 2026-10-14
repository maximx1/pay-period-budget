import { useState } from "react";
import { cn } from "../../lib/cn.ts";

export type Slice = { name: string; color: string; value: number };

type DonutChartProps = {
  /** Largest first reads best. Slices of nothing are left out. */
  slices: readonly Slice[];
  format: (value: number) => string;
  /** What the total in the middle is a total of, e.g. "spent". */
  totalLabel: string;
  /** Said to a screen reader in place of the drawing; the list beside it carries the numbers. */
  label: string;
};

const SIZE = 168;
const OUTER = 80;
const INNER = 56;
/** The gap between slices, as an angle at the outer edge: about two pixels. */
const PAD = 2 / OUTER;

const point = (radius: number, angle: number) =>
  `${SIZE / 2 + radius * Math.sin(angle)},${SIZE / 2 - radius * Math.cos(angle)}`;

function arcPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M${point(OUTER, start)}`,
    `A${OUTER},${OUTER} 0 ${large} 1 ${point(OUTER, end)}`,
    `L${point(INNER, end)}`,
    `A${INNER},${INNER} 0 ${large} 0 ${point(INNER, start)}`,
    "Z",
  ].join(" ");
}

/**
 * Shares of a whole. Every slice is also a row in the list beside the ring, with its
 * amount and share, so nothing depends on telling colours apart or on pointing at it.
 */
export function DonutChart({ slices, format, totalLabel, label }: DonutChartProps) {
  const [active, setActive] = useState<string | null>(null);
  const shown = slices.filter((slice) => slice.value > 0);
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-muted">Nothing to show for this span.</p>;

  let angle = 0;
  const arcs = shown.map((slice) => {
    const start = angle;
    angle += (slice.value / total) * Math.PI * 2;
    return { ...slice, start, end: angle };
  });
  const share = (value: number) => {
    const percent = (value / total) * 100;
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  };

  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} role="img" aria-label={label} className="block">
          {arcs.length === 1 ? (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={(OUTER + INNER) / 2} fill="none" stroke={arcs[0]!.color} strokeWidth={OUTER - INNER} />
          ) : (
            arcs.map((arc) => {
              // A sliver thinner than the gap would vanish: it keeps a hair of width.
              const pad = Math.min(PAD / 2, (arc.end - arc.start) / 4);
              return (
                <path
                  key={arc.name}
                  d={arcPath(arc.start + pad, arc.end - pad)}
                  fill={arc.color}
                  opacity={active === null || active === arc.name ? 1 : 0.45}
                  onPointerEnter={() => setActive(arc.name)}
                  onPointerLeave={() => setActive(null)}
                />
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-24 truncate text-xs text-muted">
            {active ? arcs.find((arc) => arc.name === active)?.name : totalLabel}
          </span>
          <span className="text-base font-semibold text-fg">
            {format(active ? (arcs.find((arc) => arc.name === active)?.value ?? total) : total)}
          </span>
        </div>
      </div>

      <ul className="flex min-w-0 flex-col gap-1 text-sm">
        {arcs.map((arc) => (
          <li
            key={arc.name}
            onPointerEnter={() => setActive(arc.name)}
            onPointerLeave={() => setActive(null)}
            className={cn("flex items-center gap-2 rounded px-1", active === arc.name && "bg-surface-2")}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: arc.color }} />
            <span className="min-w-0 flex-1 truncate text-fg">{arc.name}</span>
            <span className="shrink-0 text-fg tabular-nums">{format(arc.value)}</span>
            <span className="w-9 shrink-0 text-right text-muted tabular-nums">{share(arc.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
