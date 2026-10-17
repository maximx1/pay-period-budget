import { useLayoutEffect, useRef, useState } from "react";
import { fitName, layoutSankey, NODE_WIDTH, type SankeyData } from "./sankey.ts";

type SankeyChartProps = {
  data: SankeyData;
  format: (value: number) => string;
  /** Said to a screen reader in place of the drawing; the table view carries the numbers. */
  label: string;
};

// Text drawn over the bands keeps a rim of the card's colour so it stays readable.
const HALO = { paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 3, strokeLinejoin: "round" } as const;

/**
 * Where money came from and where it went, as bands as thick as the money in them. Every
 * bar is named with its amount and its share of the total. Pointing at a bar or a band
 * brings it forward. Sized to its container; the text does not scale with it.
 */
export function SankeyChart({ data, format, label }: SankeyChartProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = width > 0 ? layoutSankey(data, width) : null;
  const share = (value: number) => {
    const percent = data.total.value > 0 ? (value / data.total.value) * 100 : 0;
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  };
  const point = (key: string) => ({
    onPointerEnter: () => setActive(key),
    onPointerLeave: () => setActive(null),
  });
  const dimmed = (key: string) => active !== null && active !== key && key !== "total";

  return (
    <div className="flex flex-col gap-2">
      {layout && !layout.totalLabelled && (
        <p className="text-sm text-muted">
          {data.total.name}: <span className="font-semibold text-fg tabular-nums">{format(data.total.value)}</span>
        </p>
      )}
      <div ref={frame} style={{ height: layout?.height ?? 240 }}>
        {layout && (
          <svg width={width} height={layout.height} role="img" aria-label={label} className="block touch-pan-y select-none">
            {layout.links.map((link) => (
              <path
                key={link.key}
                d={link.path}
                fill={link.color}
                opacity={active === link.key ? 0.55 : dimmed(link.key) ? 0.12 : 0.3}
                {...point(link.key)}
              />
            ))}
            {layout.nodes.map((node) => (
              <rect
                key={node.key}
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={Math.max(1, node.height)}
                rx={2}
                fill={node.color}
                opacity={dimmed(node.key) ? 0.4 : 1}
                {...point(node.key)}
              />
            ))}
            {layout.labels.map((entry) => (
              <text
                key={entry.key}
                x={entry.x}
                y={entry.y}
                className="pointer-events-none text-[12px]"
                opacity={dimmed(entry.key) ? 0.45 : 1}
                style={HALO}
              >
                <title>{entry.name}</title>
                <tspan x={entry.x} dy="-0.2em" className="fill-fg font-medium">
                  {fitName(entry.name, entry.maxChars)}
                </tspan>
                <tspan x={entry.x} dy="1.25em" className="fill-muted tabular-nums">
                  {format(entry.value)} · {share(entry.value)}
                </tspan>
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
