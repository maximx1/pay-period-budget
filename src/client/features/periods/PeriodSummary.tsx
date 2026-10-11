import { History, PencilLine, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { PeriodView } from "../../../shared/budget.ts";
import { formatCents } from "../../../shared/money.ts";
import { Card } from "../../components/ui/Card.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useRecalculateStartingAmount, useRevertStartingAmount } from "./api.ts";

type StatProps = {
  label: string;
  cents: number;
  /** A sum of signed amounts, shown with a + when it comes out positive. */
  net?: boolean;
  /** Small marker after the label. */
  marker?: ReactNode;
};

function Stat({ label, cents, net = false, marker }: StatProps) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-sm text-muted">
        {label}
        {marker}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold whitespace-nowrap text-fg tabular-nums sm:text-base">
        {formatCents(cents, { showPlus: net })}
      </dd>
    </div>
  );
}

const noticeButton =
  "min-h-9 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-surface-2 disabled:opacity-60 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The period's money at a glance. Leftover leads, shown as what is left so far (paid items
 * only) out of what is projected once everything upcoming is paid too. A line at the foot
 * appears when the starting amount was set by hand or may be out of date.
 */
export function PeriodSummary({ view }: { view: PeriodView }) {
  const { period, totals } = view;
  const toast = useToast();
  const revert = useRevertStartingAmount();
  const recalculate = useRecalculateStartingAmount();

  const manual = period.startingMode === "manual";
  const stale = period.carryStale;
  const failed = (error: unknown) =>
    toast(error instanceof ApiError ? error.message : "That didn't work. Try again.", { variant: "error" });

  return (
    <Card className="mb-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-10">
      <div>
        <p className="text-sm font-medium text-muted">Leftover</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              "text-3xl font-bold tabular-nums sm:text-4xl",
              totals.leftoverCents < 0 ? "text-danger" : "text-fg",
            )}
          >
            {formatCents(totals.leftoverCents)}
          </span>
          <span className="text-sm text-muted">
            of{" "}
            <span className={cn("font-semibold tabular-nums", totals.projectedCents < 0 ? "text-danger" : "text-fg")}>
              {formatCents(totals.projectedCents)}
            </span>{" "}
            projected
          </span>
        </p>
      </div>

      {/* Wraps rather than squeezes: a large amount takes the room it needs and the rest move down. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-3 lg:gap-x-10">
        <Stat
          label="Starting"
          cents={period.startingCents}
          marker={
            manual ? (
              <PencilLine className="size-3.5" role="img" aria-label="Set by hand" />
            ) : stale ? (
              <TriangleAlert className="size-3.5 text-warning" role="img" aria-label="May be out of date" />
            ) : null
          }
        />
        <Stat label="Paid" cents={totals.paidCents} net />
        <Stat label="Upcoming" cents={totals.upcomingCents} net />
      </dl>

      {period.seq < 0 && (
        <div className="flex items-start gap-x-2 border-t border-border pt-3 text-sm text-muted lg:col-span-2">
          <History className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0">
            Before your budget started. The starting amount is worked back from your first period, so nothing
            added here changes a later balance.
          </p>
        </div>
      )}
      {stale && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm text-fg lg:col-span-2">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 basis-56">
            The starting amount may be out of date: an earlier period's was changed without carrying it forward.
          </p>
          <button
            type="button"
            className={noticeButton}
            disabled={recalculate.isPending}
            onClick={() => recalculate.mutate(period.id, { onError: failed })}
          >
            Recalculate
          </button>
        </div>
      )}
      {manual && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm text-muted lg:col-span-2">
          <PencilLine className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 basis-56">The starting amount was set by hand.</p>
          <button
            type="button"
            className={noticeButton}
            disabled={revert.isPending}
            onClick={() => revert.mutate(period.id, { onError: failed })}
          >
            Use calculated amount
          </button>
        </div>
      )}
    </Card>
  );
}
