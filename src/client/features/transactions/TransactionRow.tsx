import { ChevronDown, ChevronUp, Circle, CircleCheck, Repeat, Tag } from "lucide-react";
import { formatTime } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { cn } from "../../lib/cn.ts";

type TransactionRowProps = {
  transaction: Transaction;
  /** The name of the category it is filed under, if any. */
  categoryName?: string;
  onToggle: () => void;
  onEdit: () => void;
  /** When set, the row shows move buttons in place of the paid switch. Undefined ends of the range are disabled. */
  reorder?: { onUp?: () => void; onDown?: () => void };
};

/** One transaction: a paid/upcoming switch on the left, the rest of the row opens it for editing. */
export function TransactionRow({ transaction, categoryName, onToggle, onEdit, reorder }: TransactionRowProps) {
  const { name, amountCents, occursAt, note } = transaction;
  const paid = transaction.status === "paid";
  const income = amountCents > 0;
  // Midnight means "no particular time", which is how bills arrive.
  const time = occursAt.endsWith("T00:00") ? null : formatTime(occursAt);
  const details = [categoryName, time, note].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-1 pr-2 pl-1">
      {reorder ? (
        <div className="flex shrink-0">
          <IconButton label={`Move ${name} up`} disabled={!reorder.onUp} onClick={reorder.onUp}>
            <ChevronUp className="size-5" aria-hidden />
          </IconButton>
          <IconButton label={`Move ${name} down`} disabled={!reorder.onDown} onClick={reorder.onDown}>
            <ChevronDown className="size-5" aria-hidden />
          </IconButton>
        </div>
      ) : (
        <IconButton
          label={paid ? `Move ${name} back to upcoming` : `Mark ${name} paid`}
          aria-pressed={paid}
          onClick={onToggle}
          className={paid ? "text-primary hover:text-primary" : undefined}
        >
          {paid ? <CircleCheck className="size-6" aria-hidden /> : <Circle className="size-6" aria-hidden />}
        </IconButton>
      )}

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-fg">{name}</span>
            {transaction.billIncomeId &&
              // Added by a bill's or income's schedule, or tied to one by hand.
              (transaction.occurrenceDate ? (
                <Repeat className="size-3.5 shrink-0 text-muted" role="img" aria-label="Scheduled recurring item" />
              ) : (
                <Tag className="size-3.5 shrink-0 text-muted" role="img" aria-label="Tied to a recurring item" />
              ))}
          </span>
          {details && <span className="block truncate text-sm text-muted">{details}</span>}
        </span>
        <span className={cn("shrink-0 font-semibold tabular-nums", income ? "text-primary" : "text-fg")}>
          {income ? formatCents(amountCents, { showPlus: true }) : formatCents(-amountCents)}
        </span>
      </button>
    </li>
  );
}
