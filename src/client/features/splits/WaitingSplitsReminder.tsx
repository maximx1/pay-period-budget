import { CalendarPlus } from "lucide-react";
import { Link } from "react-router";
import { formatCents } from "../../../shared/money.ts";
import type { WaitingSplit } from "../../../shared/split.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAddWaitingSplit, useWaitingSplits } from "./api.ts";
import { addedMessage } from "./messages.ts";

/** What the payments of a split that can be added now come to, as a positive amount. */
const readyCents = (split: WaitingSplit) =>
  Math.abs(split.payments.filter((payment) => payment.inReach).reduce((sum, payment) => sum + payment.amountCents, 0));

/**
 * On the home screen: splits with payments that can be added now, once there are enough to
 * be worth it (all that is left, or several), so it does not come up every payday.
 */
export function WaitingSplitsReminder() {
  const splits = useWaitingSplits();
  const add = useAddWaitingSplit();
  const toast = useToast();
  const ready = (splits.data ?? []).filter((split) => split.remind);
  if (ready.length === 0) return null;

  async function addPayments(split: WaitingSplit) {
    try {
      toast(addedMessage(split.name, await add.mutateAsync(split.id)));
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Couldn't add those. Try again.", { variant: "error" });
    }
  }

  return (
    <Card className="mb-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <CalendarPlus className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">Split payments ready to add</h2>
          <p className="text-sm text-muted">Their pay periods can be made now.</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {ready.map((split) => {
          const rest = split.payments.length - split.inReach;
          return (
            <li key={split.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0">
                <p className="font-medium break-words text-fg">{split.name}</p>
                <p className="text-sm text-muted">
                  {split.inReach === 1 ? "1 payment" : `${split.inReach} payments`}, {formatCents(readyCents(split))}
                  {rest > 0 ? ` · ${rest} more after` : " · the last of it"}
                </p>
              </div>
              <Button
                variant="secondary"
                loading={add.isPending && add.variables === split.id}
                disabled={add.isPending}
                onClick={() => void addPayments(split)}
              >
                Add
              </Button>
            </li>
          );
        })}
      </ul>
      <Link
        to="/splits"
        className="-my-1 inline-flex min-h-11 items-center self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        See all split payments
      </Link>
    </Card>
  );
}
