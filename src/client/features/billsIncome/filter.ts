import type { BillOrIncome, BillOrIncomeKind } from "../../../shared/billsIncome.ts";

export type KindFilter = "all" | BillOrIncomeKind;
/** "scheduled" has a schedule; "unscheduled" is one that only gathers transactions as they happen. */
export type ScheduleFilter = "any" | "scheduled" | "unscheduled";

export type BillsIncomeFilters = {
  /** Looked for in the name and the description, ignoring case. */
  search: string;
  kind: KindFilter;
  schedule: ScheduleFilter;
  showArchived: boolean;
};

/** Whether the Recurring page shows this item under the filters chosen. They all have to agree. */
export function matchesFilters(
  item: Pick<BillOrIncome, "name" | "description" | "kind" | "recurrenceUnit" | "archived">,
  { search, kind, schedule, showArchived }: BillsIncomeFilters,
): boolean {
  if (item.archived && !showArchived) return false;
  if (kind !== "all" && item.kind !== kind) return false;
  if (schedule !== "any" && (item.recurrenceUnit === "none") !== (schedule === "unscheduled")) return false;
  const needle = search.trim().toLowerCase();
  return needle === "" || `${item.name}\n${item.description}`.toLowerCase().includes(needle);
}
