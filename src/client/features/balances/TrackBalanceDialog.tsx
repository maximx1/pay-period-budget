import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { canTrackBalance, CHECK_EVERY_OPTIONS, type CheckEveryDays } from "../../../shared/balances.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBillsIncome } from "../billsIncome/api.ts";
import { useBalances, useTrackBalance } from "./api.ts";
import {
  applyBalanceErrors,
  BalanceFields,
  balanceFieldsInput,
  type BalanceFormValues,
  balanceFormSchema,
  blankBalanceFields,
} from "./BalanceFields.tsx";

type TrackBalanceDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The bill or transfer to track, when it is already known. Otherwise the dialog asks. */
  billIncomeId?: string | null;
  onTracked?: (billIncomeId: string) => void;
};

/** Starts tracking a bill or transfer's balance, from what the account says now. */
export function TrackBalanceDialog({ open, onClose, billIncomeId, onTracked }: TrackBalanceDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Track a balance">
      <TrackForm onClose={onClose} billIncomeId={billIncomeId ?? null} onTracked={onTracked} />
    </Dialog>
  );
}

/** "About every month (your usual)" first, then the others. */
export function everyOptions(usual: CheckEveryDays | undefined) {
  return [
    { value: "", label: usual ? `${labelOf(usual)} (your usual)` : "Your usual" },
    ...CHECK_EVERY_OPTIONS.map(({ days, label }) => ({ value: String(days), label })),
  ];
}
const labelOf = (days: CheckEveryDays) => CHECK_EVERY_OPTIONS.find((option) => option.days === days)?.label ?? "";

function TrackForm({ onClose, billIncomeId, onTracked }: Omit<TrackBalanceDialogProps, "open" | "billIncomeId"> & { billIncomeId: string | null }) {
  const items = useBillsIncome();
  const balances = useBalances();
  const track = useTrackBalance();
  const toast = useToast();
  const form = useForm<BalanceFormValues>({
    resolver: zodResolver(balanceFormSchema),
    defaultValues: { ...blankBalanceFields, billIncomeId: billIncomeId ?? "", every: "" },
  });

  const tracked = new Set((balances.data?.balances ?? []).map((balance) => balance.billIncomeId));
  const candidates = (items.data ?? []).filter(
    (item) => canTrackBalance(item.kind) && !item.archived && (!tracked.has(item.id) || item.id === billIncomeId),
  );
  const fixed = billIncomeId ? (items.data ?? []).find((item) => item.id === billIncomeId) : undefined;

  const submit = form.handleSubmit((values) => {
    if (!values.billIncomeId) {
      form.setError("billIncomeId", { message: "Choose a bill or transfer" });
      return;
    }
    const id = values.billIncomeId;
    track.mutate(
      {
        billIncomeId: id,
        input: { ...balanceFieldsInput(values), checkEveryDays: values.every ? (Number(values.every) as CheckEveryDays) : null },
      },
      {
        onSuccess: ({ balance }) => {
          toast(`Tracking ${balance.name}.`);
          onClose();
          onTracked?.(id);
        },
        onError: (error) => {
          const fields = error instanceof ApiError ? error.fields : undefined;
          if (fields?.billIncomeId) form.setError("billIncomeId", { message: fields.billIncomeId });
          if (!applyBalanceErrors(error, form) && !fields?.billIncomeId) {
            toast(error instanceof ApiError ? error.message : "Couldn't save that. Try again.", { variant: "error" });
          }
        },
      },
    );
  });

  if (items.isPending) return <div className="h-48 animate-pulse rounded-lg bg-surface-2" role="status" aria-label="Loading" />;
  if (!fixed && candidates.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Every bill and transfer is tracked already, or there are none yet. A balance belongs to a bill (a loan, a card)
          or a transfer (savings, a joint account): add one under Recurring first.
        </p>
        <DialogActions>
          <Button data-autofocus onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {fixed ? (
        <p className="font-medium break-words text-fg">{fixed.name}</p>
      ) : (
        <SelectField
          label="Bill or transfer"
          data-autofocus
          options={[{ value: "", label: "Choose one" }, ...candidates.map((item) => ({ value: item.id, label: item.name }))]}
          error={form.formState.errors.billIncomeId?.message}
          {...form.register("billIncomeId")}
        />
      )}
      <BalanceFields form={form} autoFocus={Boolean(fixed)} amountLabel="Balance now" />
      <SelectField
        label="Ask me to check it"
        options={everyOptions(balances.data?.settings.checkEveryDays)}
        hint="Payments tied to it move the estimate in between."
        {...form.register("every")}
      />
      <DialogActions>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={track.isPending}>
          Track it
        </Button>
      </DialogActions>
    </form>
  );
}
