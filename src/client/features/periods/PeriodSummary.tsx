import type { PeriodView } from "../../../shared/budget.ts";
import { formatCents } from "../../../shared/money.ts";
import { Card } from "../../components/ui/Card.tsx";
import { cn } from "../../lib/cn.ts";

/** `net` marks a sum of signed amounts, shown with a + when it comes out positive. */
function Stat({ label, cents, net = false }: { label: string; cents: number; net?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold break-words text-fg tabular-nums sm:text-base">{formatCents(cents, { showPlus: net })}</dd>
    </div>
  );
}

/**
 * The period's money at a glance. Leftover leads, shown as what is left so far (paid items
 * only) out of what is projected once everything upcoming is paid too.
 */
export function PeriodSummary({ view }: { view: PeriodView }) {
  const { period, totals } = view;

  return (
    <Card className="mb-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
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

      <dl className="grid grid-cols-3 gap-4 lg:gap-10">
        <Stat label="Starting" cents={period.startingCents} />
        <Stat label="Paid" cents={totals.paidCents} net />
        <Stat label="Upcoming" cents={totals.upcomingCents} net />
      </dl>
    </Card>
  );
}
