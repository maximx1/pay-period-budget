import { cn } from "../../lib/cn.ts";

export type TableData = {
  /** The first column is the row's name; the rest are figures, set to the right. */
  head: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
};

/** The numbers behind a chart, or a report that is a table to begin with. Scrolls sideways within its card. */
export function DataTable({ head, rows, empty = "Nothing to show for this span." }: TableData & { empty?: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr>
            {head.map((cell, column) => (
              <th
                key={column}
                scope="col"
                className={cn("border-b border-border px-2 py-1.5 text-xs font-medium text-muted", column === 0 ? "text-left" : "text-right")}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              {row.map((cell, column) =>
                column === 0 ? (
                  <th key={column} scope="row" className="max-w-48 truncate px-2 py-1.5 text-left font-normal text-fg">
                    {cell}
                  </th>
                ) : (
                  <td key={column} className="px-2 py-1.5 text-right whitespace-nowrap text-fg tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
