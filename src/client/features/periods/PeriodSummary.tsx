import { ChevronDown, History, PencilLine, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { PeriodView } from "../../../shared/budget.ts";
import { formatDay, type LocalDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { SegmentedBar } from "../../components/charts/SegmentedBar.tsx";
import { SERIES_COLORS } from "../../components/charts/palette.ts";
import { Card } from "../../components/ui/Card.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { InfoTip } from "../../components/ui/InfoTip.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useBillsIncome } from "../billsIncome/api.ts";
import { useCategories } from "../categories/api.ts";
import { rankSeries } from "../reports/derive.ts";
import { useRecalculateStartingAmount, useRevertStartingAmount } from "./api.ts";
import { endedWithUpcoming, summaryFigures } from "./summaryFigures.ts";

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

type BalanceProps = {
  label: string;
  cents: number;
  /** Shown red whatever its value, with this beside the label saying why. */
  warning?: ReactNode;
};

/** A balance on its own line: a small label over a big figure, red below zero. */
function Balance({ label, cents, warning }: BalanceProps) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {label}
        {warning}
      </p>
      <p className={cn("mt-0.5 text-3xl font-bold tabular-nums sm:text-4xl", cents < 0 || warning ? "text-danger" : "text-fg")}>
        {formatCents(cents)}
      </p>
    </div>
  );
}

/**
 * How much of the period's money has been handled so far: income received and expenses
 * paid, against everything in the period in both directions. Each counts by its size, so
 * a paycheck still to come holds the bar back as much as a bill does.
 */
function PaidProgress({ paidCents, toComeCents }: { paidCents: number; toComeCents: number }) {
  const totalCents = paidCents + toComeCents;
  if (totalCents === 0) return null;
  const share = paidCents / totalCents;
  return (
    <div className="lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <p className="text-muted">
          <span className="font-semibold text-fg tabular-nums">{formatCents(paidCents)}</span> of{" "}
          <span className="tabular-nums">{formatCents(totalCents)}</span> handled
        </p>
        <p className="text-muted">
          <span className="font-semibold text-fg tabular-nums">{formatCents(toComeCents)}</span> still to come
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Money handled so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * The period's money at a glance. Two balances lead: the current one (the starting amount
 * plus everything paid, which is what the bank should show) and the one at the end of the
 * period once everything upcoming is paid too. Beside them: what the period started with,
 * all the money coming in and all the money going out, paid or not, so the three make the
 * end balance; each transfer counts once there, as the difference between what was sent to
 * it and what came back. Under them a bar of how much of the money, in and out, is handled. The caret
 * opens where the money out went, by category and by bills, transfers and spontaneous spending,
 * and what the Paid and Upcoming totals below are made of. A period that is over with
 * anything still upcoming turns the card yellow and its current balance red. A line appears
 * when the starting amount was set by hand or may be out of date.
 */
export function PeriodSummary({ view, today }: { view: PeriodView; today: LocalDate }) {
  const { period, totals } = view;
  const toast = useToast();
  const revert = useRevertStartingAmount();
  const recalculate = useRecalculateStartingAmount();
  const [expanded, setExpanded] = useState(false);
  const breakdownId = useId();

  const categories = useCategories();
  const billsIncome = useBillsIncome();
  const transfers = new Map(
    billsIncome.data?.filter((item) => item.kind === "transfer").map((item) => [item.id, { categoryId: item.categoryId }]),
  );
  const figures = summaryFigures(view, transfers);
  const { incomeCents, expenseCents } = figures;
  const unresolved = endedWithUpcoming(view, today);
  const upcomingCount = view.transactions.filter((transaction) => transaction.status === "upcoming").length;

  // Largest first, seven colours and "Other", the same way the Reports page hands them out.
  const categoryNames = new Map(categories.data?.map((category) => [category.id, category.name]));
  const { series, keyOf } = rankSeries(figures.expensesByCategory, (id) => categoryNames.get(id), "Uncategorised");
  const byKey = new Map<string, number>();
  for (const [id, cents] of figures.expensesByCategory) byKey.set(keyOf(id), (byKey.get(keyOf(id)) ?? 0) + cents);

  const manual = period.startingMode === "manual";
  const stale = period.carryStale;
  const failed = (error: unknown) =>
    toast(error instanceof ApiError ? error.message : "That didn't work. Try again.", { variant: "error" });

  return (
    <Card
      tone={unresolved ? "warning" : "default"}
      className="mb-4 grid grid-cols-1 gap-5 pb-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-10"
    >
      <div className="flex flex-col gap-3">
        <Balance
          label="Current balance"
          cents={totals.leftoverCents}
          warning={
            unresolved && (
              <InfoTip label="Why is this red?" icon={<TriangleAlert className="size-4 text-warning" aria-hidden />}>
                This period ended on {formatDay(period.endDate)}, but {upcomingCount === 1 ? "1 transaction is" : `${upcomingCount} transactions are`}{" "}
                still upcoming, so this balance won&rsquo;t match your bank. Mark each one paid, or remove or move it if it
                didn&rsquo;t happen.
              </InfoTip>
            )
          }
        />
        <Balance label="Balance at end of period" cents={totals.projectedCents} />
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
        <Stat label="Income" cents={incomeCents} net />
        <Stat label="Expenses" cents={expenseCents} />
      </dl>

      <PaidProgress
        paidCents={figures.incomePaidCents + figures.expensesPaidCents}
        toComeCents={figures.incomeToComeCents + figures.expensesToComeCents}
      />

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

      {expanded && (
        <div id={breakdownId} className="flex flex-col gap-5 border-t border-border pt-4 lg:col-span-2">
          <SegmentedBar
            title="Money out by category"
            summary={formatCents(expenseCents)}
            format={formatCents}
            segments={series.map(({ key, name, color }) => ({ name, color, value: byKey.get(key) ?? 0 }))}
          />
          <SegmentedBar
            title="Bills, transfers and spontaneous spending"
            summary={formatCents(expenseCents)}
            format={formatCents}
            segments={[
              { name: "From bills", value: figures.expensesFromBillsCents, color: SERIES_COLORS[0] },
              { name: "Transfers", value: figures.expensesToTransfersCents, color: SERIES_COLORS[1] },
              { name: "Spontaneous", value: figures.expensesSpontaneousCents, color: SERIES_COLORS[2] },
            ]}
          />
          {transfers.size > 0 && (
            <p className="text-sm text-muted">
              A transfer counts once here, as what was sent less what came back this period. Its transactions below
              stay as they are.
            </p>
          )}
          <p className="text-sm text-muted">
            The Paid total is income received less expenses paid,{" "}
            <span className="font-semibold text-fg tabular-nums">{formatCents(totals.paidCents, { showPlus: true })}</span>.
            Upcoming is the same for what is still to come,{" "}
            <span className="font-semibold text-fg tabular-nums">{formatCents(totals.upcomingCents, { showPlus: true })}</span>.
          </p>
        </div>
      )}

      <div className="-mt-3 flex justify-center lg:col-span-2">
        <IconButton
          label={expanded ? "Hide the breakdown" : "Show the breakdown"}
          aria-expanded={expanded}
          aria-controls={expanded ? breakdownId : undefined}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDown className={cn("size-5 transition-transform", expanded && "rotate-180")} aria-hidden />
        </IconButton>
      </div>
    </Card>
  );
}
