import { Circle, CircleCheck } from "lucide-react";
import { formatTime } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { cn } from "../../lib/cn.ts";

type TransactionRowProps = {
  transaction: Transaction;
  onToggle: () => void;
  onEdit: () => void;
};

/** One transaction: a paid/upcoming switch on the left, the rest of the row opens it for editing. */
export function TransactionRow({ transaction, onToggle, onEdit }: TransactionRowProps) {
  const { name, amountCents, occursAt, note } = transaction;
  const paid = transaction.status === "paid";
  const income = amountCents > 0;
  // Midnight means "no particular time", which is how bills arrive.
  const time = occursAt.endsWith("T00:00") ? null : formatTime(occursAt);
  const details = [time, note].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-1 pr-2 pl-1">
      <IconButton
        label={paid ? `Move ${name} back to upcoming` : `Mark ${name} paid`}
        aria-pressed={paid}
        onClick={onToggle}
        className={paid ? "text-primary hover:text-primary" : undefined}
      >
        {paid ? <CircleCheck className="size-6" aria-hidden /> : <Circle className="size-6" aria-hidden />}
      </IconButton>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-fg">{name}</span>
          {details && <span className="block truncate text-sm text-muted">{details}</span>}
        </span>
        <span className={cn("shrink-0 font-semibold tabular-nums", income ? "text-primary" : "text-fg")}>
          {income ? formatCents(amountCents, { showPlus: true }) : formatCents(-amountCents)}
        </span>
      </button>
    </li>
  );
}
