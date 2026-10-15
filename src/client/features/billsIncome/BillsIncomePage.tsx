import { Plus, ReceiptText, Search, SearchX } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { BillOrIncome } from "../../../shared/billsIncome.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { useBudget } from "../budget/api.ts";
import { useCategories } from "../categories/api.ts";
import { DETAIL_PARAM, useBillsIncome } from "./api.ts";
import { BillOrIncomeCard } from "./BillOrIncomeCard.tsx";
import { BillOrIncomeDetailDialog } from "./BillOrIncomeDetailDialog.tsx";
import { BillOrIncomeDialog } from "./BillOrIncomeDialog.tsx";
import { type KindFilter, matchesFilters, type ScheduleFilter } from "./filter.ts";

const kindFilters = [
  { value: "all", label: "All" },
  { value: "expense", label: "Bills" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
] as const satisfies ReadonlyArray<{ value: KindFilter; label: string }>;

const scheduleFilters = [
  { value: "any", label: "Any" },
  { value: "scheduled", label: "Scheduled" },
  { value: "unscheduled", label: "As it happens" },
] as const satisfies ReadonlyArray<{ value: ScheduleFilter; label: string }>;

const gridClass = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

/** Bills and income, as a filterable grid of cards. */
export function BillsIncomePage() {
  const items = useBillsIncome();
  const budget = useBudget();
  const categories = useCategories();
  const categoryNames = new Map(categories.data?.map((category) => [category.id, category.name]));
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [schedule, setSchedule] = useState<ScheduleFilter>("any");
  const [showArchived, setShowArchived] = useState(false);
  // `item` is kept after closing so the dialog doesn't change its title while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; item?: BillOrIncome }>({ open: false });
  const [detail, setDetail] = useState<{ open: boolean; item?: BillOrIncome }>({ open: false });

  // Arriving with ?item=<id> (from one of its transactions) opens that item's detail view.
  // The parameter is dropped once used, so closing the view leaves a plain page behind.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(DETAIL_PARAM);
  useEffect(() => {
    if (!requested || !items.data) return;
    const item = items.data.find((entry) => entry.id === requested);
    if (item) setDetail({ open: true, item });
    setSearchParams(
      (params) => {
        params.delete(DETAIL_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [requested, items.data, setSearchParams]);

  const addButton = (
    <Button onClick={() => setDialog({ open: true })}>
      <Plus className="size-4" aria-hidden />
      Add bill or income
    </Button>
  );

  let content: ReactNode;
  if (items.isPending) {
    content = (
      <div className={gridClass} role="status" aria-label="Loading bills and income">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-36 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    );
  } else if (items.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your bills and income.</Alert>
        <Button variant="secondary" onClick={() => items.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (items.data.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={ReceiptText}
          title="No bills or income yet"
          description="Add a bill or a paycheck on a schedule and it shows up in every period it falls in. Or add one as it happens, to gather payments that come when they come. A transfer is for money you move to another account of yours, and back."
          action={addButton}
        />
      </Card>
    );
  } else {
    const visible = items.data.filter((item) => matchesFilters(item, { search, kind, schedule, showArchived }));
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
              aria-label="Search bills and income"
              className="min-h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base text-fg placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-ring"
            />
          </div>
          <SegmentedControl label="Show" hideLabel fitLabels options={kindFilters} value={kind} onChange={setKind} />
          <SegmentedControl label="Schedule" hideLabel fitLabels options={scheduleFilters} value={schedule} onChange={setSchedule} />
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
              <BillOrIncomeCard
                key={item.id}
                item={item}
                categoryName={item.categoryId ? categoryNames.get(item.categoryId) : undefined}
                onOpen={() => setDetail({ open: true, item })}
                onEdit={() => setDialog({ open: true, item })}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Bills & Income" subtitle="What you pay and what you're paid, on a schedule or as it happens." actions={items.data?.length ? addButton : undefined} />
      {content}
      <BillOrIncomeDialog
        open={dialog.open}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        timezone={budget.data?.timezone ?? "UTC"}
        item={dialog.item}
      />
      <BillOrIncomeDetailDialog
        open={detail.open}
        onClose={() => setDetail((current) => ({ ...current, open: false }))}
        timezone={budget.data?.timezone ?? "UTC"}
        // The list's copy, so an edit made from here shows when the detail is next opened.
        item={items.data?.find((item) => item.id === detail.item?.id) ?? detail.item}
        onEdit={() => setDialog({ open: true, item: detail.item })}
      />
    </>
  );
}
