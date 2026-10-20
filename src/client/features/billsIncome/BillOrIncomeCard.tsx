import { Pencil } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatDay } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { BillOrIncome } from "../../../shared/billsIncome.ts";
import { Card } from "../../components/ui/Card.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { cn } from "../../lib/cn.ts";
import { Linkified } from "./Linkified.tsx";

/** The description, cut to four lines with a toggle when there is more. */
function Description({ text }: { text: string }) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured rather than guessed from length: wrapping depends on the card's width.
  useLayoutEffect(() => {
    const element = paragraph.current;
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div>
      <p
        ref={paragraph}
        className={cn("text-sm break-words whitespace-pre-wrap text-muted", !expanded && "line-clamp-4")}
      >
        <Linkified text={text} />
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 rounded text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

type BillOrIncomeCardProps = {
  item: BillOrIncome;
  /** The name of the category its entries are filed under, if any. */
  categoryName?: string;
  /** The card itself: show what has gone to this bill or income. */
  onOpen: () => void;
  onEdit: () => void;
};

export function BillOrIncomeCard({ item, categoryName, onOpen, onEdit }: BillOrIncomeCardProps) {
  const income = item.kind === "income";
  const transfer = item.kind === "transfer";

  return (
    // The name is the button; its ::after covers the card, so a click anywhere on it opens
    // the detail. The pencil and the description's own links and toggle sit above that.
    <Card
      className={cn(
        "relative flex flex-col gap-3 transition-colors hover:bg-surface-2 has-[h3>button:focus-visible]:outline-2 has-[h3>button:focus-visible]:outline-offset-2 has-[h3>button:focus-visible]:outline-ring",
        item.archived && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-fg">
            <button
              type="button"
              onClick={onOpen}
              aria-label={`${item.name}: show its transactions`}
              className="max-w-full truncate text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
            >
              {item.name}
            </button>
          </h3>
          <p className="text-sm text-muted">
            {transfer && "Transfer · "}
            {item.scheduleText}
            {categoryName && ` · ${categoryName}`}
          </p>
          {item.dueText && <p className="text-sm text-muted">{item.dueText}</p>}
        </div>
        <IconButton label={`Edit ${item.name}`} onClick={onEdit} className="relative z-10 -mt-2 -mr-2">
          <Pencil className="size-5" aria-hidden />
        </IconButton>
      </div>

      {/* Only something with no schedule can be without a usual amount. */}
      {item.defaultAmountCents > 0 && (
        <p className={cn("text-xl font-bold tabular-nums", income ? "text-primary" : "text-fg")}>
          {income ? formatCents(item.defaultAmountCents, { showPlus: true }) : formatCents(item.defaultAmountCents)}
        </p>
      )}

      {(item.nextDueDate || item.nextDueBy || item.archived) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          {item.nextDueDate && <span>Next: {formatDay(item.nextDueDate)}</span>}
          {item.nextDueBy && <span>Due: {formatDay(item.nextDueBy)}</span>}
          {item.archived && (
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
              Archived
            </span>
          )}
        </div>
      )}

      {item.description && (
        <div className="relative z-10 self-start">
          <Description text={item.description} />
        </div>
      )}
    </Card>
  );
}
