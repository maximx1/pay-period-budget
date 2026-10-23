import { type ReactNode, useState } from "react";
import { Card } from "../ui/Card.tsx";
import { DataTable, type TableData } from "./DataTable.tsx";
import type { ChartSeries } from "./XYChart.tsx";

// A chart in its card, with the numbers behind it a tap away: every chart offers them as a
// table. Used by the Reports page and the Balances page.

type ChartCardProps = {
  title: string;
  /** One line saying what is being shown and what counts. */
  about: string;
  /** The same numbers as a table, offered beside the chart. */
  table?: TableData;
  /** A choice that belongs to this report alone. */
  controls?: ReactNode;
  /** Takes the whole width of the section on wide screens. */
  wide?: boolean;
  children: ReactNode;
};

/** One chart: what it is, the drawing, and the numbers behind it for anyone who would rather read them. */
export function ChartCard({ title, about, table, controls, wide, children }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={`flex min-w-0 flex-col gap-3 ${wide ? "xl:col-span-2" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg">{title}</h3>
          <p className="text-sm text-muted">{about}</p>
        </div>
        {table && (
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((value) => !value)}
            className="-mt-2 -mr-2 min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {asTable ? "Chart" : "Table"}
          </button>
        )}
      </div>
      {controls}
      {asTable && table ? <DataTable {...table} /> : children}
    </Card>
  );
}

/** A chart's series as a table: one row for each position along the bottom. */
export function seriesTable(first: string, titles: readonly string[], series: readonly ChartSeries[], format: (value: number) => string): TableData {
  return {
    head: [first, ...series.map((entry) => entry.name)],
    rows: titles.map((title, i) => [title, ...series.map((entry) => (entry.values[i] == null ? "" : format(entry.values[i]!)))]),
  };
}
