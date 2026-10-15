import { cn } from "../../lib/cn.ts";

export type Segment = { name: string; value: number; color: string };

type SegmentedBarProps = {
  title: string;
  /** Beside the title, e.g. the total. */
  summary?: string;
  /** In the order they are drawn, left to right. Segments of nothing are left out. */
  segments: readonly Segment[];
  format: (value: number) => string;
  className?: string;
};

/**
 * One bar split into shares of a whole, like a disk's storage bar. Every segment is also
 * named in the list under it with its amount, so nothing depends on telling colours apart.
 */
export function SegmentedBar({ title, summary, segments, format, className }: SegmentedBarProps) {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) return null;

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="font-medium text-fg">{title}</span>
        {summary && <span className="text-muted tabular-nums">{summary}</span>}
      </figcaption>
      <div aria-hidden className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-md">
        {shown.map((segment) => (
          <div
            key={segment.name}
            className="h-full min-w-0.5"
            style={{ flexGrow: segment.value, flexBasis: 0, backgroundColor: segment.color }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((segment) => (
          <li key={segment.name} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="truncate text-muted">{segment.name}</span>
            <span className="font-medium text-fg tabular-nums">{format(segment.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
