import { useEffect, useRef, useState } from "react";
import { dateOf, formatDay, formatLongDate, type LocalDateTime } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { PaymentList } from "../transactions/SplitFields.tsx";
import { useSkipPreview, useSkipSplitPayment } from "./api.ts";

type SkipPaymentProps = {
  splitId: string;
  /** The payment to leave out. */
  transaction: { id: string; occursAt: LocalDateTime; amountCents: number };
  /** After it was skipped. */
  onDone: () => void;
  onCancel: () => void;
};

/**
 * Asks before skipping one payment of a split, showing what the payments after it become,
 * as the server works it out. Refused (the last payment before an item is due) it says why.
 */
export function SkipPayment({ splitId, transaction, onDone, onCancel }: SkipPaymentProps) {
  const toast = useToast();
  const request = { splitId, input: { transactionId: transaction.id } };
  const preview = useSkipPreview(request);
  const skip = useSkipSplitPayment();
  const [error, setError] = useState<string | null>(null);
  // Asked at the foot of a long dialog, so brought into view.
  const section = useRef<HTMLElement>(null);
  useEffect(() => section.current?.scrollIntoView({ block: "nearest" }), [preview.data, preview.error]);
  const day = formatDay(dateOf(transaction.occursAt));
  const refusal = preview.error instanceof ApiError ? preview.error.message : preview.isError ? "Couldn't work that out. Try again." : null;
  const after = preview.data ? [...preview.data.payments, ...preview.data.later] : [];

  async function confirm() {
    setError(null);
    try {
      const { payments, later } = await skip.mutateAsync(request);
      const rest = payments.length + later.length;
      onDone();
      toast(
        rest === 0
          ? `Skipped the ${day} payment`
          : `Skipped the ${day} payment. ${rest === 1 ? "The one after it covers" : `The ${rest} after it cover`} it.`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't skip that. Try again.");
    }
  }

  return (
    <section ref={section} aria-label="Skip this payment" className="flex flex-col gap-3">
      <p className="text-sm font-medium text-fg">
        Skip the {formatCents(Math.abs(transaction.amountCents))} payment on {formatLongDate(dateOf(transaction.occursAt))}?
      </p>
      {error && <Alert>{error}</Alert>}
      {refusal ? (
        <Alert>{refusal}</Alert>
      ) : !preview.data ? (
        <p className="text-sm text-muted">Working out the payments after it…</p>
      ) : after.length === 0 ? (
        <p className="text-sm text-muted">Nothing after it needs to change.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            What it holds moves onto {after.length === 1 ? "the payment" : `the ${after.length} payments`} after it:
          </p>
          <PaymentList payments={after} labels={preview.data.labels} firstYear={transaction.occursAt.slice(0, 4)} />
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={skip.isPending}>
          Keep it
        </Button>
        {!refusal && (
          <Button onClick={() => void confirm()} loading={skip.isPending} disabled={!preview.data}>
            Skip it
          </Button>
        )}
      </div>
    </section>
  );
}
