import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import type { PeriodView } from "../../../shared/budget.ts";
import { atStartOfDay, dateOf, formatDateRange, formatDay, nowIn } from "../../../shared/dates.ts";
import { centsToInput, formatCents, parseMoneyInput } from "../../../shared/money.ts";
import {
  MAX_TRANSACTION_CENTS,
  type Transaction,
  type TransactionResponse,
  transactionInputSchema,
} from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { applyApiError } from "../auth/formErrors.ts";
import { useBillsIncome } from "../billsIncome/api.ts";
import { useCreateTransaction, useDeleteTransaction, useUpdateTransaction } from "./api.ts";

const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

// The server's rules for the fields it shares with this form, plus the form's own shapes
// for the amount (typed as text) and the optional extras.
const formSchema = transactionInputSchema.pick({ name: true, kind: true, occursAt: true }).extend({
  amount: z.string().refine((text) => parseAmount(text) !== null, "Enter an amount like 27.50"),
  note: z.string().max(500, "Keep the note under 500 characters"),
  paid: z.boolean(),
  /** The bill or income it belongs to; empty for none. */
  billIncomeId: z.string(),
  /** An upcoming entry of that bill or income which this pays toward; empty for none. */
  countsToward: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

const kindOptions = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
] as const;

type TransactionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The period on screen: sets the default date and decides whether a save "moved" the item. */
  view: PeriodView;
  /** The budget's time zone, for "now". */
  timezone: string;
  /** Present when editing; absent when adding. */
  transaction?: Transaction;
};

export function TransactionDialog({ open, onClose, transaction, ...rest }: TransactionDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={transaction ? "Edit transaction" : "Add transaction"}>
      <TransactionForm onClose={onClose} transaction={transaction} {...rest} />
    </Dialog>
  );
}

function TransactionForm({ onClose, view, timezone, transaction }: Omit<TransactionDialogProps, "open">) {
  const toast = useToast();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();
  const [formError, setFormError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(Boolean(transaction?.note));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // New items default to right now when looking at the current period, otherwise to the
  // first day of the period on screen (adding to a past or future period is deliberate).
  const now = nowIn(timezone, new Date());
  const { startDate, endDate } = view.period;
  const defaultOccursAt = startDate <= dateOf(now) && dateOf(now) <= endDate ? now : atStartOfDay(startDate);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: transaction
      ? {
          name: transaction.name,
          amount: centsToInput(transaction.amountCents),
          kind: transaction.kind,
          occursAt: transaction.occursAt,
          note: transaction.note ?? "",
          paid: transaction.status === "paid",
          billIncomeId: transaction.billIncomeId ?? "",
          countsToward: "",
        }
      : {
          name: "",
          amount: "",
          kind: "expense",
          occursAt: defaultOccursAt,
          note: "",
          paid: false,
          billIncomeId: "",
          countsToward: "",
        },
  });

  // Bills and income to tie this to: the current ones, and the one it is already tied to
  // even if that has since ended.
  const items = useBillsIncome();
  const [chosenId, chosenKind] = watch(["billIncomeId", "kind"]);
  const choices = (items.data ?? []).filter((item) => !item.archived || item.id === transaction?.billIncomeId);
  const itemOptions = [{ value: "", label: "None" }, ...choices.map((item) => ({ value: item.id, label: item.name }))];

  // What a new payment could be paying: the upcoming entries that bill or income added to
  // the period on screen. Paying toward one shrinks it, so the bill is not counted twice.
  const payable = transaction
    ? []
    : view.transactions.filter(
        (entry) =>
          chosenId !== "" &&
          entry.billIncomeId === chosenId &&
          entry.occurrenceDate !== null &&
          entry.status === "upcoming" &&
          entry.kind === chosenKind,
      );
  const towardOptions = [
    { value: "", label: chosenKind === "income" ? "Nothing: this is on top of it" : "Nothing: this is an extra payment" },
    ...payable.map((entry) => ({
      value: entry.id,
      label: `The ${formatCents(Math.abs(entry.amountCents))} due ${formatDay(dateOf(entry.occursAt))}`,
    })),
  ];

  /** Picking a bill or income for a new transaction fills in what is known about it. */
  function choose(itemId: string) {
    setValue("countsToward", "");
    const item = choices.find((choice) => choice.id === itemId);
    if (!item || transaction) return;
    if (getValues("name").trim() === "") setValue("name", item.name);
    // A transfer goes either way, so whichever way this one was said to go stands.
    if (item.kind !== "transfer") setValue("kind", item.kind);
    if (getValues("amount").trim() === "" && item.defaultAmountCents > 0) {
      setValue("amount", centsToInput(item.defaultAmountCents));
    }
  }
  const itemField = register("billIncomeId");
  const chosen = choices.find((choice) => choice.id === chosenId);
  // Says which way this one counts, so that what the money is then spent on is not tied here by mistake.
  const transferHint =
    chosen?.kind === "transfer"
      ? chosenKind === "income"
        ? `Money coming back from ${chosen.name}.`
        : `Money going to ${chosen.name}.`
      : undefined;

  function finish({ period, countedToward }: TransactionResponse) {
    onClose();
    if (countedToward) {
      toast(
        countedToward.removed
          ? `${countedToward.name} is paid off.`
          : `${formatCents(Math.abs(countedToward.remainingCents))} of ${countedToward.name} is still upcoming.`,
      );
    } else if (period.id !== view.period.id) {
      toast(`${transaction ? "Moved" : "Added"} to ${formatDateRange(period.startDate, period.endDate)}`);
    }
  }

  const onSubmit = handleSubmit(async ({ name, amount, kind, occursAt, note, paid, billIncomeId, countsToward }) => {
    setFormError(null);
    const amountCents = parseAmount(amount) ?? 0;
    const tiedTo = billIncomeId === "" ? null : billIncomeId;
    try {
      finish(
        transaction
          ? await update.mutateAsync({
              id: transaction.id,
              // Sent only when it changed, so an edit of something else never re-ties anything.
              patch: {
                name,
                amountCents,
                kind,
                occursAt,
                note,
                ...(tiedTo !== transaction.billIncomeId && { billIncomeId: tiedTo }),
              },
            })
          : await create.mutateAsync({
              name,
              amountCents,
              kind,
              occursAt,
              note,
              paid,
              billIncomeId: tiedTo,
              ...(countsToward !== "" && payable.some((entry) => entry.id === countsToward) && { countsToward }),
            }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.fields?.amountCents) {
        setError("amount", { message: error.fields.amountCents });
      }
      setFormError(applyApiError(error, setError, ["name", "occursAt", "note", "billIncomeId", "countsToward"]));
    }
  });

  async function deleteTransaction() {
    if (!transaction) return;
    setFormError(null);
    try {
      await remove.mutateAsync(transaction.id);
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Couldn't delete that. Try again.");
      setConfirmingDelete(false);
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <TextField label="Name" autoComplete="off" data-autofocus error={errors.name?.message} {...register("name")} />

      <div className="grid grid-cols-2 items-start gap-3">
        <TextField
          label="Amount"
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          error={errors.amount?.message}
          {...register("amount")}
        />
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <SegmentedControl label="Type" options={kindOptions} value={field.value} onChange={field.onChange} />
          )}
        />
      </div>

      <TextField
        label="Date and time"
        type="datetime-local"
        error={errors.occursAt?.message}
        {...register("occursAt")}
      />

      {choices.length > 0 && (
        <SelectField
          label="Bill or income"
          options={itemOptions}
          hint={chosenId === "" ? "Optional. Groups this with one of your bills or incomes." : transferHint}
          error={errors.billIncomeId?.message}
          {...itemField}
          onChange={(event) => {
            void itemField.onChange(event);
            choose(event.target.value);
          }}
        />
      )}

      {payable.length > 0 && (
        <SelectField
          label="Counts toward"
          options={towardOptions}
          hint="Choosing an upcoming entry shrinks it by this amount, and removes it once it is paid off."
          error={errors.countsToward?.message}
          {...register("countsToward")}
        />
      )}

      {showNote ? (
        <TextField label="Note" autoComplete="off" error={errors.note?.message} {...register("note")} />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="-my-1 min-h-11 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Add a note
        </button>
      )}

      {!transaction && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg">
          <input type="checkbox" className="size-5 accent-primary" {...register("paid")} />
          Already paid
        </label>
      )}

      {confirmingDelete ? (
        <DialogActions>
          <p className="self-center text-sm font-medium text-fg sm:mr-auto">Delete this transaction?</p>
          <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending}>
            Keep it
          </Button>
          <Button variant="danger" onClick={deleteTransaction} loading={remove.isPending}>
            Delete
          </Button>
        </DialogActions>
      ) : (
        <DialogActions>
          {transaction && (
            <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {transaction ? "Save" : "Add"}
          </Button>
        </DialogActions>
      )}
    </form>
  );
}
