import { Plus, Repeat, Search, SearchX } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { RecurringItem } from "../../../shared/recurring.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { useBudget } from "../budget/api.ts";
import { useRecurringItems } from "./api.ts";
import { RecurringCard } from "./RecurringCard.tsx";
import { RecurringDialog } from "./RecurringDialog.tsx";

type KindFilter = "all" | "expense" | "income";

const kindFilters = [
  { value: "all", label: "All" },
  { value: "expense", label: "Bills" },
  { value: "income", label: "Income" },
] as const;

const gridClass = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

function matches(item: RecurringItem, search: string, kind: KindFilter, showArchived: boolean): boolean {
  if (item.archived && !showArchived) return false;
  if (kind !== "all" && item.kind !== kind) return false;
  const needle = search.trim().toLowerCase();
  return needle === "" || `${item.name}\n${item.description}`.toLowerCase().includes(needle);
}

/** Recurring bills and income, as a filterable grid of cards. */
export function RecurringPage() {
  const items = useRecurringItems();
  const budget = useBudget();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  // `item` is kept after closing so the dialog doesn't change its title while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; item?: RecurringItem }>({ open: false });

  const addButton = (
    <Button onClick={() => setDialog({ open: true })}>
      <Plus className="size-4" aria-hidden />
      Add recurring
    </Button>
  );

  let content: ReactNode;
  if (items.isPending) {
    content = (
      <div className={gridClass} role="status" aria-label="Loading recurring items">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-36 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    );
  } else if (items.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your recurring items.</Alert>
        <Button variant="secondary" onClick={() => items.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (items.data.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={Repeat}
          title="No recurring items yet"
          description="Add a bill or a paycheck once and it shows up in every period it falls in."
          action={addButton}
        />
      </Card>
    );
  } else {
    const visible = items.data.filter((item) => matches(item, search, kind, showArchived));
    const archivedCount = items.data.filter((item) => item.archived).length;

    content = (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search recurring items"
              className="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base text-fg placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-ring"
            />
          </div>
          <SegmentedControl label="Show" hideLabel options={kindFilters} value={kind} onChange={setKind} />
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived{archivedCount > 0 && ` (${archivedCount})`}
          </label>
        </div>

        {visible.length === 0 ? (
          <Card>
            <EmptyState icon={SearchX} title="Nothing matches" description="Try a different search or filter." />
          </Card>
        ) : (
          <div className={gridClass}>
            {visible.map((item) => (
              <RecurringCard key={item.id} item={item} onEdit={() => setDialog({ open: true, item })} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Recurring" subtitle="Bills and income that repeat." actions={items.data?.length ? addButton : undefined} />
      {content}
      <RecurringDialog
        open={dialog.open}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        timezone={budget.data?.timezone ?? "UTC"}
        item={dialog.item}
      />
    </>
  );
}
