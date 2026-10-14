import { useLayoutEffect, useRef, useState } from "react";
import { Legend } from "./Legend.tsx";

export type ChartSeries = {
  name: string;
  color: string;
  /** One per position along the bottom. Null leaves a gap (lines only). */
  values: ReadonlyArray<number | null>;
  /** For side-by-side columns that can go below zero: the colour of the ones that do. */
  negativeColor?: string;
};

type XYChartProps = {
  /** A short label for each position along the bottom. */
  labels: readonly string[];
  /** A fuller name for each position, for the readout. Defaults to the label. */
  titles?: readonly string[];
  /** Columns: stacked on one another, or side by side. Stacked values must not be negative. */
  bars?: { series: readonly ChartSeries[]; mode: "stacked" | "grouped" };
  lines?: readonly ChartSeries[];
  /** A value in full, for the readout. */
  format: (value: number) => string;
  /** A value in brief, for the scale. */
  formatAxis: (value: number) => string;
  /** Said to a screen reader in place of the drawing; the table view carries the numbers. */
  label: string;
  height?: number;
};

const MARGIN = { top: 10, right: 10, bottom: 24, left: 46 };
const MAX_BAR = 24;
const GAP = 2;

/** About four round steps covering lowest..highest. */
function ticksFor(lowest: number, highest: number): number[] {
  const span = highest - lowest || 1;
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = Math.floor(lowest / step) * step; tick <= highest + step * 0.001; tick += step) ticks.push(tick);
  if (ticks.at(-1)! < highest) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

/** A column from `base` to `end`, rounded at the end the data reaches and square at its base. */
function columnPath(x: number, base: number, end: number, width: number): string {
  const radius = Math.min(4, width / 2, Math.abs(end - base));
  const toward = end < base ? 1 : -1;
  return [
    `M${x},${base}`,
    `V${end + toward * radius}`,
    `Q${x},${end} ${x + radius},${end}`,
    `H${x + width - radius}`,
    `Q${x + width},${end} ${x + width},${end + toward * radius}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

/**
 * Columns and lines over shared positions, on one scale. Pointing at a position reads out
 * every series there. Sized to its container; the text does not scale with it.
 */
export function XYChart({ labels, titles, bars, lines = [], format, formatAxis, label, height = 220 }: XYChartProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const count = labels.length;
  const barSeries = bars?.series ?? [];
  const stacked = bars?.mode === "stacked";

  // The scale always includes zero: columns grow from it.
  let lowest = 0;
  let highest = 0;
  for (let i = 0; i < count; i++) {
    if (stacked) highest = Math.max(highest, barSeries.reduce((sum, series) => sum + Math.max(0, series.values[i] ?? 0), 0));
    else for (const series of barSeries) {
      lowest = Math.min(lowest, series.values[i] ?? 0);
      highest = Math.max(highest, series.values[i] ?? 0);
    }
    for (const series of lines) {
      const value = series.values[i];
      if (value == null) continue;
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
  }
  if (lowest === 0 && highest === 0) highest = 1;
  const ticks = ticksFor(lowest, highest);
  const [bottom, top] = [ticks[0]!, ticks.at(-1)!];

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const band = count > 0 ? plotWidth / count : 0;
  const xOf = (i: number) => MARGIN.left + band * (i + 0.5);
  const yOf = (value: number) => MARGIN.top + plotHeight * (1 - (value - bottom) / (top - bottom));
  // Enough room for each label that is shown; the rest are left to the readout.
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 52))));

  const groupSize = Math.max(1, barSeries.length);
  const barWidth = stacked
    ? Math.min(MAX_BAR, band * 0.62)
    : Math.min(MAX_BAR, (band * 0.76 - GAP * (groupSize - 1)) / groupSize);

  const legend = [
    ...barSeries.map(({ name, color }) => ({ name, color })),
    ...lines.map(({ name, color }) => ({ name, color, line: true })),
  ];
  const readout =
    active === null
      ? []
      : [...barSeries, ...lines]
          .map((series) => ({ ...series, value: series.values[active] }))
          .filter((row): row is ChartSeries & { value: number } => row.value != null && (row.value !== 0 || legend.length <= 3));
  const tipLeft = active === null ? 0 : Math.min(Math.max(xOf(active), 88), Math.max(88, width - 88));

  return (
    <div className="flex flex-col gap-2">
      {legend.length > 1 && <Legend items={legend} />}
      <div ref={frame} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label} className="block touch-pan-y select-none">
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={yOf(tick)}
                  y2={yOf(tick)}
                  className={tick === 0 ? "stroke-muted" : "stroke-border"}
                  strokeWidth={1}
                />
                <text x={MARGIN.left - 6} y={yOf(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {formatAxis(tick)}
                </text>
              </g>
            ))}

            {labels.map((text, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={xOf(i)} y={height - 7} textAnchor="middle" className="fill-muted text-[11px]">
                  {text}
                </text>
              ) : null,
            )}

            {active !== null && lines.length > 0 && (
              <line x1={xOf(active)} x2={xOf(active)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="stroke-muted" strokeWidth={1} />
            )}

            {labels.map((_, i) => {
              if (stacked) {
                let base = 0;
                const drawn = barSeries.filter((series) => (series.values[i] ?? 0) > 0);
                return drawn.map((series, layer) => {
                  const value = series.values[i] ?? 0;
                  const from = yOf(base);
                  base += value;
                  // A gap the colour of the card separates each layer from the one above it.
                  const to = Math.min(from, yOf(base) + (layer < drawn.length - 1 ? GAP : 0));
                  const x = xOf(i) - barWidth / 2;
                  return layer === drawn.length - 1 ? (
                    <path key={series.name} d={columnPath(x, from, to, barWidth)} fill={series.color} opacity={active === null || active === i ? 1 : 0.55} />
                  ) : (
                    <rect key={series.name} x={x} y={to} width={barWidth} height={Math.max(0, from - to)} fill={series.color} opacity={active === null || active === i ? 1 : 0.55} />
                  );
                });
              }
              return barSeries.map((series, slot) => {
                const value = series.values[i] ?? 0;
                if (value === 0) return null;
                const groupWidth = barWidth * groupSize + GAP * (groupSize - 1);
                const x = xOf(i) - groupWidth / 2 + slot * (barWidth + GAP);
                return (
                  <path
                    key={series.name}
                    d={columnPath(x, yOf(0), yOf(value), barWidth)}
                    fill={value < 0 ? (series.negativeColor ?? series.color) : series.color}
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                );
              });
            })}

            {lines.map((series) => {
              // A null breaks the line: each run of values is drawn by itself.
              const runs: string[] = [];
              let run = "";
              let last: number | null = null;
              series.values.forEach((value, i) => {
                if (value == null) {
                  if (run) runs.push(run);
                  run = "";
                  return;
                }
                run += `${run ? "L" : "M"}${xOf(i)},${yOf(value)} `;
                last = i;
              });
              if (run) runs.push(run);
              const lastValue = last === null ? null : series.values[last];
              return (
                <g key={series.name}>
                  {runs.map((d, i) => (
                    <path key={i} d={d} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {last !== null && lastValue != null && (
                    <circle cx={xOf(last)} cy={yOf(lastValue)} r={4} fill={series.color} className="stroke-surface" strokeWidth={2} />
                  )}
                  {active !== null && series.values[active] != null && (
                    <circle cx={xOf(active)} cy={yOf(series.values[active]!)} r={4} fill={series.color} className="stroke-surface" strokeWidth={2} />
                  )}
                </g>
              );
            })}

            {/* The whole column is the target, not just the ink in it. */}
            {labels.map((_, i) => (
              <rect
                key={i}
                x={MARGIN.left + band * i}
                y={MARGIN.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
                onPointerLeave={() => setActive((current) => (current === i ? null : current))}
              />
            ))}
          </svg>
        )}

        {active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-lg"
            style={{ left: tipLeft }}
          >
            <p className="mb-1 font-medium text-muted">{titles?.[active] ?? labels[active]}</p>
            {readout.length === 0 ? (
              <p className="text-muted">Nothing</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {readout.map((row) => (
                  <li key={row.name} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className="min-w-0 flex-1 truncate text-muted">{row.name}</span>
                    <span className="shrink-0 font-semibold text-fg tabular-nums">{format(row.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
