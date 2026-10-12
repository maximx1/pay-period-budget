import { Pencil } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatDay } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { RecurringItem } from "../../../shared/recurring.ts";
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

export function RecurringCard({ item, onEdit }: { item: RecurringItem; onEdit: () => void }) {
  const income = item.kind === "income";

  return (
    <Card className={cn("flex flex-col gap-3", item.archived && "opacity-75")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-fg">{item.name}</h3>
          <p className="text-sm text-muted">{item.scheduleText}</p>
        </div>
        <IconButton label={`Edit ${item.name}`} onClick={onEdit} className="-mt-2 -mr-2">
          <Pencil className="size-5" aria-hidden />
        </IconButton>
      </div>

      {/* Only something with no schedule can be without a usual amount. */}
      {item.defaultAmountCents > 0 && (
        <p className={cn("text-xl font-bold tabular-nums", income ? "text-primary" : "text-fg")}>
          {income ? formatCents(item.defaultAmountCents, { showPlus: true }) : formatCents(item.defaultAmountCents)}
        </p>
      )}

      {(item.nextDueDate || item.archived) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {item.nextDueDate && <span>Next: {formatDay(item.nextDueDate)}</span>}
          {item.archived && (
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
              Archived
            </span>
          )}
        </div>
      )}

      {item.description && <Description text={item.description} />}
    </Card>
  );
}
