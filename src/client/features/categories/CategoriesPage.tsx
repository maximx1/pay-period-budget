import { Plus, Tags } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Category, PeriodCategoryLimit } from "../../../shared/categories.ts";
import { formatCents } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { cn } from "../../lib/cn.ts";
import { usePeriodView } from "../periods/api.ts";
import { useCategories } from "./api.ts";
import { CategoryDialog } from "./CategoryDialog.tsx";

const gridClass = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

type CategoryCardProps = {
  category: Category;
  /** The current pay period's limit for it, if it has one. */
  current?: PeriodCategoryLimit;
  onEdit: () => void;
};

function CategoryCard({ category, current, onEdit }: CategoryCardProps) {
  const over = current !== undefined && current.spentCents > current.limitCents;

  return (
    // The name is the button; its ::after covers the card, so a click anywhere on it opens the dialog.
    <Card className="relative flex flex-col gap-1 transition-colors hover:bg-surface-2 has-[h3>button:focus-visible]:outline-2 has-[h3>button:focus-visible]:outline-offset-2 has-[h3>button:focus-visible]:outline-ring">
      <h3 className="truncate font-semibold text-fg">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${category.name}`}
          className="max-w-full truncate text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
        >
          {category.name}
        </button>
      </h3>
      <p className="text-sm text-muted">
        {category.defaultLimitCents === null
          ? "No usual limit"
          : `${formatCents(category.defaultLimitCents)} each pay period`}
      </p>
      {current && (
        <p className={cn("mt-2 text-sm font-medium tabular-nums", over ? "text-warning" : "text-fg")}>
          {formatCents(current.spentCents)} of {formatCents(current.limitCents)} this period
        </p>
      )}
    </Card>
  );
}

/** Categories: what transactions are filed under, and the limit each pay period usually gets. */
export function CategoriesPage() {
  const categories = useCategories();
  // Today's period, for how each category stands against its limit right now.
  const currentPeriod = usePeriodView(undefined);
  // `category` is kept after closing so the dialog doesn't change its title while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; category?: Category }>({ open: false });

  const addButton = (
    <Button onClick={() => setDialog({ open: true })}>
      <Plus className="size-4" aria-hidden />
      Add category
    </Button>
  );

  let content: ReactNode;
  if (categories.isPending) {
    content = (
      <div className={gridClass} role="status" aria-label="Loading categories">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-24 animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
    );
  } else if (categories.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your categories.</Alert>
        <Button variant="secondary" onClick={() => categories.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (categories.data.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={Tags}
          title="No categories yet"
          description="Add one, such as Groceries, then file transactions under it. Give it a limit and you're told when a pay period goes over."
          action={addButton}
        />
      </Card>
    );
  } else {
    const limits = new Map(currentPeriod.data?.categoryLimits.map((limit) => [limit.categoryId, limit]));
    content = (
      <div className={gridClass}>
        {categories.data.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            current={limits.get(category.id)}
            onEdit={() => setDialog({ open: true, category })}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="What your spending is filed under, and how much of it each pay period allows."
        actions={categories.data?.length ? addButton : undefined}
      />
      {content}
      <CategoryDialog
        open={dialog.open}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        category={dialog.category}
      />
    </>
  );
}
