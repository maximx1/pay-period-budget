import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { addYearsClamped, dateOf, formatDay, formatLongDate, nowIn } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { SplitSummary, SplitUpcomingPayment } from "../../../shared/split.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useBudget } from "../budget/api.ts";
import { AddToSplitForm } from "../transactions/TransactionDialog.tsx";
import { useAddWaitingSplit, useCancelWaitingSplit, useWaitingSplits } from "./api.ts";
import { addedMessage } from "./messages.ts";
import { SkipPayment } from "./SkipPayment.tsx";

/** Every split with something left to pay: its payments, adding to it, skipping one, and what waits. */
export function SplitsPage() {
  const splits = useWaitingSplits();

  return (
    <>
      <PageHeader
        title="Split payments"
        subtitle="Splits with something left to pay. Add more to one, skip a payment, or add the payments that were too far ahead to make."
      />
      {splits.isError ? (
        <Alert>Couldn't load split payments. Try again.</Alert>
      ) : !splits.data ? null : splits.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Nothing left to pay"
            description="Splits you make with “Split it up” are listed here until they are paid."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {splits.data.map((split) => (
            <SplitCard key={split.id} split={split} />
          ))}
        </div>
      )}
    </>
  );
}

function SplitCard({ split }: { split: SplitSummary }) {
  const budget = useBudget();
  const [skipping, setSkipping] = useState<SplitUpcomingPayment | null>(null);
  const [adding, setAdding] = useState(false);
  const upcoming = split.upcoming ?? [];
  const items = split.items ?? [];
  const left = items.length > 0 ? items.reduce((sum, item) => sum + item.leftCents, 0) : Math.abs(split.totalCents);
  const count = upcoming.length + split.payments.length;
  const timezone = budget.data?.timezone;
  // A payment in any other year than the first one's shows its year.
  const firstYear = upcoming[0]?.occursAt.slice(0, 4);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="min-w-0 font-semibold break-words text-fg">{split.name}</h2>
        <p className="text-sm text-muted">
          {formatCents(left)} left in {count === 1 ? "1 payment" : `${count} payments`}
        </p>
      </div>
      {(items.length > 1 || split.roundUp) && (
        <ul className="flex flex-col gap-0.5 text-sm text-muted">
          {items.length > 1 &&
            items.map((item) => (
              <li key={item.id} className="break-words">
                {item.label}: {formatCents(item.leftCents)} left of {formatCents(item.amountCents)}, due {formatDay(item.dueDate)}
              </li>
            ))}
          {split.roundUp && <li>Each payment rounds up to the next $50.</li>}
        </ul>
      )}

      {upcoming.length > 0 && (
        <ol className="divide-y divide-border rounded-xl border border-border">
          {upcoming.map((payment) => (
            <li key={payment.id} className="flex items-center gap-3 py-1 pr-1 pl-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                <div className="flex items-baseline justify-between gap-3 text-sm text-fg">
                  <span>
                    {formatDay(dateOf(payment.occursAt))}
                    {payment.occursAt.slice(0, 4) !== firstYear && `, ${payment.occursAt.slice(0, 4)}`}
                  </span>
                  <span className="font-medium tabular-nums">{formatCents(payment.amountCents)}</span>
                </div>
                {payment.note && <p className="text-xs break-words text-muted">{payment.note}</p>}
              </div>
              {split.editable && (
                <Button variant="ghost" className="shrink-0 px-3 text-primary" onClick={() => setSkipping(payment)}>
                  Skip
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}

      {split.payments.length > 0 && <Waiting split={split} />}

      {split.editable && timezone && (
        <Button variant="secondary" className="self-start" onClick={() => setAdding(true)}>
          Add to this split
        </Button>
      )}

      <Dialog open={skipping !== null} onClose={() => setSkipping(null)} title={`Skip a ${split.name} payment`}>
        {skipping && (
          <SkipPayment splitId={split.id} transaction={skipping} onDone={() => setSkipping(null)} onCancel={() => setSkipping(null)} />
        )}
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add to ${split.name}`}>
        {adding && timezone && (
          <AddToSplitForm split={split} defaultOccursAt={nowIn(timezone, new Date())} onClose={() => setAdding(false)} />
        )}
      </Dialog>
    </Card>
  );
}

/** A split's payments too far ahead to be made yet: which can be now, adding them, and dropping the rest. */
function Waiting({ split }: { split: SplitSummary }) {
  const toast = useToast();
  const add = useAddWaitingSplit();
  const cancel = useCancelWaitingSplit();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = split.payments.find((payment) => !payment.inReach);

  async function addPayments() {
    setError(null);
    try {
      toast(addedMessage(split.name, await add.mutateAsync(split.id)));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't add those. Try again.");
    }
  }

  async function stopWaiting() {
    setError(null);
    try {
      await cancel.mutateAsync(split.id);
      toast(`${split.name}: the rest won't be added`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't do that. Try again.");
      setConfirming(false);
    }
  }

  return (
    <section aria-label="Waiting" className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-fg">
          Waiting: {formatCents(Math.abs(split.totalCents))} in {split.payments.length === 1 ? "1 payment" : `${split.payments.length} payments`}
        </h3>
        <p className="text-sm text-muted">
          {split.inReach === 0
            ? // A payment comes within reach about a year ahead of its date; the server decides exactly.
              `More than a year ahead. The first can be added around ${formatLongDate(addYearsClamped(dateOf(next!.occursAt), -1))}.`
            : split.inReach === split.payments.length
              ? "All of them can be added now."
              : `${split.inReach} can be added now; the rest as their pay periods come within a year.`}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      <ol className="divide-y divide-border rounded-xl border border-dashed border-border">
        {split.payments.map((payment) => (
          <li key={payment.id} className="flex flex-col gap-0.5 px-3 py-2">
            <div className={cn("flex items-baseline justify-between gap-3 text-sm", payment.inReach ? "text-fg" : "text-muted")}>
              <span>
                {/* Always a year or more ahead, so always with its year. */}
                {formatDay(dateOf(payment.occursAt))}, {payment.occursAt.slice(0, 4)}
                {payment.inReach && <span className="ml-2 text-xs font-semibold text-primary">Ready</span>}
              </span>
              <span className="font-medium tabular-nums">{formatCents(payment.amountCents)}</span>
            </div>
            {payment.note && <p className="text-xs break-words text-muted">{payment.note}</p>}
          </li>
        ))}
      </ol>

      {confirming ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-fg sm:mr-auto">Drop these? What was already added stays.</p>
          <div className="flex gap-2 self-end">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={cancel.isPending}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => void stopWaiting()} loading={cancel.isPending}>
              Drop them
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setConfirming(true)}>
            Drop the rest
          </Button>
          {split.inReach > 0 && (
            <Button onClick={() => void addPayments()} loading={add.isPending}>
              {split.inReach === 1 ? "Add 1 now" : `Add ${split.inReach} now`}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
