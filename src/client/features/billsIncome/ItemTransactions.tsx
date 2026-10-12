import { Circle, CircleCheck } from "lucide-react";
import { Link } from "react-router";
import type { PeriodSummary } from "../../../shared/budget.ts";
import { dateOf, formatLongDate, type LocalDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { cn } from "../../lib/cn.ts";

/** An amount the way the home screen shows it: money in with a plus, money out bare. */
export const shownAmount = (cents: number) => (cents > 0 ? formatCents(cents, { showPlus: true }) : formatCents(-cents));

/**
 * Where a transaction can be seen in context: the pay period that covers its date, opened
 * at that date. Null when no period covers it (they are loaded, or it predates them).
 */
export function periodPathFor(periods: readonly PeriodSummary[] | undefined, date: LocalDate, today: LocalDate): string | null {
  const period = periods?.find((candidate) => candidate.startDate <= date && date <= candidate.endDate);
  if (!period) return null;
  // Today's period lives at "/", like the Today link.
  const path = period.startDate <= today && today <= period.endDate ? "/" : `/periods/${period.id}`;
  return `${path}?date=${date}`;
}

type ItemTransactionListProps = {
  transactions: readonly Transaction[];
  periods: readonly PeriodSummary[] | undefined;
  today: LocalDate;
  /** Called when a row is followed to its period, e.g. to close the dialog it is in. */
  onNavigate?: () => void;
};

/** The transactions tied to one bill or income, newest first. Each row opens its pay period. */
export function ItemTransactionList({ transactions, periods, today, onNavigate }: ItemTransactionListProps) {
  return (
    <ul className="divide-y divide-border">
      {transactions.map((transaction) => {
        const date = dateOf(transaction.occursAt);
        const path = periodPathFor(periods, date, today);
        const paid = transaction.status === "paid";
        const row = (
          <>
            {paid ? (
              <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden />
            ) : (
              <Circle className="size-5 shrink-0 text-muted" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-fg">{transaction.name}</span>
              <span className="block truncate text-sm text-muted">
                {formatLongDate(date)} · {paid ? "Paid" : "Upcoming"}
                {transaction.note ? ` · ${transaction.note}` : ""}
              </span>
            </span>
            <span className={cn("shrink-0 font-semibold tabular-nums", transaction.amountCents > 0 ? "text-primary" : "text-fg")}>
              {shownAmount(transaction.amountCents)}
            </span>
          </>
        );
        const rowClass = "flex min-h-11 items-center gap-3 rounded-lg px-2 py-2";
        return (
          <li key={transaction.id}>
            {path ? (
              <Link
                to={path}
                onClick={onNavigate}
                className={cn(
                  rowClass,
                  "transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                )}
              >
                {row}
              </Link>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The three figures for one bill or income: what has been paid, what is still to come, and how many. */
export function ItemTotals({ totals }: { totals: { count: number; paidCents: number; upcomingCents: number } }) {
  const figures = [
    { label: "Paid", value: shownAmount(totals.paidCents) },
    { label: "Upcoming", value: shownAmount(totals.upcomingCents) },
    { label: "Transactions", value: String(totals.count) },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {figures.map(({ label, value }) => (
        <div key={label} className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
          <dt className="truncate text-xs text-muted">{label}</dt>
          <dd className="truncate font-semibold text-fg tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
