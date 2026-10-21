import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { addYearsClamped, dateOf, formatDay, formatLongDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import type { WaitingSplit } from "../../../shared/split.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useAddWaitingSplit, useCancelWaitingSplit, useWaitingSplits } from "./api.ts";
import { addedMessage } from "./messages.ts";

/** The payments splits left waiting for pay periods too far ahead to exist yet. */
export function SplitsPage() {
  const splits = useWaitingSplits();

  return (
    <>
      <PageHeader title="Split payments" subtitle="Payments of a split that fall more than a year ahead wait here until their pay periods can be made." />
      {splits.isError ? (
        <Alert>Couldn't load split payments. Try again.</Alert>
      ) : !splits.data ? null : splits.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Nothing waiting"
            description="When a split runs more than a year ahead, the payments that can't be added yet wait here, and the home screen says when they can be."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {splits.data.map((split) => (
            <WaitingSplitCard key={split.id} split={split} />
          ))}
        </div>
      )}
    </>
  );
}

function WaitingSplitCard({ split }: { split: WaitingSplit }) {
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
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="min-w-0 font-semibold break-words text-fg">{split.name}</h2>
        <p className="text-sm text-muted">
          {formatCents(Math.abs(split.totalCents))} in {split.payments.length === 1 ? "1 payment" : `${split.payments.length} payments`}
        </p>
      </div>
      <p className="text-sm text-muted">
        {split.inReach === 0
          ? // A payment comes within reach about a year ahead of its date; the server decides exactly.
            `The first can be added around ${formatLongDate(addYearsClamped(dateOf(next!.occursAt), -1))}.`
          : split.inReach === split.payments.length
            ? "All of them can be added now."
            : `${split.inReach} can be added now; the rest as their pay periods come within a year.`}
      </p>
      {error && <Alert>{error}</Alert>}

      <ol className="divide-y divide-border rounded-xl border border-border">
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
    </Card>
  );
}
