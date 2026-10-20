import { ListFilter, Search } from "lucide-react";
import { useId, useState } from "react";
import type { Category } from "../../../shared/categories.ts";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { cn } from "../../lib/cn.ts";
import { NO_CATEGORY, type PeriodFilter } from "./periodFilter.ts";

type PeriodFilterBarProps = {
  filter: PeriodFilter;
  onChange: (filter: PeriodFilter) => void;
  categories: Category[];
};

const chipClass = (chosen: boolean) =>
  cn(
    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    chosen ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-fg hover:bg-surface-2",
  );

/**
 * A quick way to slim down this period's Upcoming and Paid lists: a search box, and a
 * button that opens a row of categories to show only those.
 */
export function PeriodFilterBar({ filter, onChange, categories }: PeriodFilterBarProps) {
  const panelId = useId();
  // Open from the start when the categories already narrow the list, so it is clear why.
  const [open, setOpen] = useState(filter.categoryIds.size > 0);
  const chosen = filter.categoryIds.size;

  const toggle = (id: string) => {
    const categoryIds = new Set(filter.categoryIds);
    if (categoryIds.has(id)) categoryIds.delete(id);
    else categoryIds.add(id);
    onChange({ ...filter, categoryIds });
  };
  const options = [...categories.map((category) => ({ id: category.id, name: category.name })), { id: NO_CATEGORY, name: "No category" }];

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={filter.text}
            onChange={(event) => onChange({ ...filter, text: event.target.value })}
            placeholder="Search this period"
            aria-label="Search this period's transactions"
            autoComplete="off"
            className="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base text-fg placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-ring"
          />
        </div>
        <IconButton
          label={chosen > 0 ? `Filter by category, ${chosen} chosen` : "Filter by category"}
          variant="secondary"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
          className={cn("relative", chosen > 0 && "border-primary text-primary")}
        >
          <ListFilter className="size-5" aria-hidden />
          {chosen > 0 && (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg"
            >
              {chosen}
            </span>
          )}
        </IconButton>
      </div>

      {open && (
        <div id={panelId} role="group" aria-label="Show only these categories" className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter.categoryIds.has(option.id)}
              onClick={() => toggle(option.id)}
              className={chipClass(filter.categoryIds.has(option.id))}
            >
              {option.name}
            </button>
          ))}
          {chosen > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filter, categoryIds: new Set() })}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
