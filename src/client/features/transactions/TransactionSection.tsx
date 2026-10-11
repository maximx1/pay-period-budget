import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import { dateOf, formatDay, type LocalDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { TransactionRow } from "./TransactionRow.tsx";

type TransactionSectionProps = {
  title: string;
  /** Already in display order. */
  transactions: Transaction[];
  totalCents: number;
  empty: { icon: LucideIcon; title: string; description: string };
  onToggle: (transaction: Transaction) => void;
  onEdit: (transaction: Transaction) => void;
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
export function TransactionSection({ title, transactions, totalCents, empty, onToggle, onEdit }: TransactionSectionProps) {
  const headingId = useId();

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
          {groupByDay(transactions).map(([day, items]) => (
            <div key={day}>
              <p className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{formatDay(day)}</p>
              <ul>
                {items.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    onToggle={() => onToggle(transaction)}
                    onEdit={() => onEdit(transaction)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
