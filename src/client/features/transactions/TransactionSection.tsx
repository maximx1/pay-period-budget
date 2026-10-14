import type { LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { dateOf, formatDay, type LocalDate, type LocalDateTime } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { cn } from "../../lib/cn.ts";
import { useCategories } from "../categories/api.ts";
import { TransactionRow } from "./TransactionRow.tsx";

type TransactionSectionProps = {
  title: string;
  /** Already in display order. */
  transactions: Transaction[];
  totalCents: number;
  empty: { icon: LucideIcon; title: string; description: string };
  onToggle: (transaction: Transaction) => void;
  onEdit: (transaction: Transaction) => void;
  /** Called with this section's rows at one date and time, in their new order. */
  onReorder: (occursAt: LocalDateTime, orderedIds: string[]) => void;
  /** A day to point out, when the user arrived by searching for a date. */
  highlightDay?: LocalDate | null;
};

function groupByDay(transactions: Transaction[]): Array<[LocalDate, Transaction[]]> {
  const groups: Array<[LocalDate, Transaction[]]> = [];
  for (const transaction of transactions) {
    const day = dateOf(transaction.occursAt);
    const last = groups.at(-1);
    if (last && last[0] === day) last[1].push(transaction);
    else groups.push([day, [transaction]]);
  }
  return groups;
}

/** "Upcoming" or "Paid": a running total in the header and the rows grouped under their day. */
export function TransactionSection({
  title,
  transactions,
  totalCents,
  empty,
  onToggle,
  onEdit,
  onReorder,
  highlightDay,
}: TransactionSectionProps) {
  const headingId = useId();
  const categories = useCategories();
  const categoryNames = new Map(categories.data?.map((category) => [category.id, category.name]));
  // The day whose rows are showing move buttons, if any.
  const [reorderingDay, setReorderingDay] = useState<LocalDate | null>(null);

  return (
    <Card padding="none" role="region" aria-labelledby={headingId}>
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h3 id={headingId} className="font-semibold text-fg">
          {title}
          <span className="ml-2 text-sm font-normal text-muted">{transactions.length}</span>
        </h3>
        <p className="font-semibold text-fg tabular-nums">{formatCents(totalCents, { showPlus: true })}</p>
      </header>

      {transactions.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <div className="pb-2">
          {groupByDay(transactions).map(([day, items]) => {
            // Order can only be chosen among rows at exactly the same date and time.
            const sameMoment = (occursAt: LocalDateTime) => items.filter((item) => item.occursAt === occursAt);
            const canReorder = items.some((item) => sameMoment(item.occursAt).length > 1);
            const reordering = canReorder && reorderingDay === day;

            return (
              <div
                key={day}
                data-day={day}
                // Choosing an order is fiddly enough without the period sliding away under it.
                data-swipe-lock={reordering ? "" : undefined}
                className={cn(day === highlightDay && "rounded-lg ring-2 ring-ring ring-inset")}
              >
                <div className="flex min-h-9 items-end justify-between px-4 pt-2 pb-1">
                  <p
                    className={cn(
                      "text-xs font-semibold tracking-wide uppercase",
                      day === highlightDay ? "text-primary" : "text-muted",
                    )}
                  >
                    {formatDay(day)}
                  </p>
                  {canReorder && (
                    <button
                      type="button"
                      aria-pressed={reordering}
                      onClick={() => setReorderingDay(reordering ? null : day)}
                      className="-my-2 -mr-2 min-h-9 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {reordering ? "Done" : "Reorder"}
                    </button>
                  )}
                </div>
                <ul>
                  {items.map((transaction) => {
                    const peers = sameMoment(transaction.occursAt);
                    const index = peers.indexOf(transaction);
                    const swapWith = (other: number) => () => {
                      const ids = peers.map((peer) => peer.id);
                      [ids[index], ids[other]] = [ids[other]!, ids[index]!];
                      onReorder(transaction.occursAt, ids);
                    };
                    return (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        categoryName={transaction.categoryId ? categoryNames.get(transaction.categoryId) : undefined}
                        onToggle={() => onToggle(transaction)}
                        onEdit={() => onEdit(transaction)}
                        reorder={
                          reordering && peers.length > 1
                            ? {
                                onUp: index > 0 ? swapWith(index - 1) : undefined,
                                onDown: index < peers.length - 1 ? swapWith(index + 1) : undefined,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
