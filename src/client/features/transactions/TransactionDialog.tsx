import { zodResolver } from "@hookform/resolvers/zod";
import { Repeat, Search } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
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
import { billOrIncomeDetailPath, useBillsIncome, useCreateBillOrIncome } from "../billsIncome/api.ts";
import { useCategories, useCreateCategory } from "../categories/api.ts";
import { ScreenshotPicker } from "../scan/ScreenshotPicker.tsx";
import { useCreateTransaction, useDeleteTransaction, useUpdateTransaction } from "./api.ts";

const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

/** In the Category list: make a new category, named in a field that then appears. */
const NEW_CATEGORY = "__new__";
/** In the Transfer list: make a new transfer, likewise. */
const NEW_TRANSFER = "__new_transfer__";

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
  /** The category it is filed under; empty for none; NEW_CATEGORY for one named below. */
  categoryId: z.string(),
  /** The name of a category made as this is saved. */
  newCategory: z.string(),
  /** The name of a transfer made as this is saved. */
  newTransfer: z.string(),
}).superRefine(({ categoryId, newCategory, billIncomeId, newTransfer }, context) => {
  const named = (value: string, field: "newCategory" | "newTransfer", what: string, max: number) => {
    const name = value.trim();
    if (!name) context.addIssue({ code: "custom", path: [field], message: `Name the new ${what}` });
    else if (name.length > max) context.addIssue({ code: "custom", path: [field], message: `Keep the name under ${max} characters` });
  };
  if (categoryId === NEW_CATEGORY) named(newCategory, "newCategory", "category", 40);
  if (billIncomeId === NEW_TRANSFER) named(newTransfer, "newTransfer", "transfer", 80);
});
type FormValues = z.infer<typeof formSchema>;

// A transfer is not a third way for money to move: it is money sent to, or brought back
// from, one of the owner's other accounts, saved as an expense or income tied to that transfer.
const typeOptions = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;
const directionOptions = [
  { value: "expense", label: "Sent to it" },
  { value: "income", label: "Came back" },
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
  /** Asks for a search for other transactions like the one being edited. */
  onFindLike?: (transaction: Transaction) => void;
  /** When adding: offers a second tab that picks screenshots to import from, and hands them here. */
  onScan?: (files: File[]) => void;
};

const addTabs = [
  { value: "type", label: "Type it in" },
  { value: "screenshots", label: "From screenshots" },
] as const;

export function TransactionDialog({ open, onClose, transaction, onScan, ...rest }: TransactionDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={transaction ? "Edit transaction" : "Add transaction"}>
      {!transaction && onScan ? (
        <AddTabs onScan={onScan} onClose={onClose} {...rest} />
      ) : (
        <TransactionForm onClose={onClose} transaction={transaction} {...rest} />
      )}
    </Dialog>
  );
}

function AddTabs({ onScan, ...rest }: Omit<TransactionDialogProps, "open" | "transaction" | "onScan"> & { onScan: (files: File[]) => void }) {
  const [tab, setTab] = useState<(typeof addTabs)[number]["value"]>("type");
  return (
    <>
      <div className="mb-4">
        <SegmentedControl label="How to add it" hideLabel options={addTabs} value={tab} onChange={setTab} />
      </div>
      {tab === "type" ? <TransactionForm {...rest} /> : <ScreenshotPicker onPick={onScan} />}
    </>
  );
}

function TransactionForm({ onClose, view, timezone, transaction, onFindLike }: Omit<TransactionDialogProps, "open">) {
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
          categoryId: transaction.categoryId ?? "",
          newCategory: "",
          newTransfer: "",
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
          categoryId: "",
          newCategory: "",
          newTransfer: "",
        },
  });

  // Bills and income to tie this to: the current ones, and the one it is already tied to
  // even if that has since ended.
  const items = useBillsIncome();
  const [chosenId, chosenKind] = watch(["billIncomeId", "kind"]);
  const choices = (items.data ?? []).filter((item) => !item.archived || item.id === transaction?.billIncomeId);
  // The bill or income this is saved against: the one its detail view opens for.
  const linkedItem = items.data?.find((item) => item.id === transaction?.billIncomeId);
  const navigate = useNavigate();
  const createTransfer = useCreateBillOrIncome();
  // Whether Type says Transfer. Until it is touched, it follows what this is tied to.
  const [typeChosen, setTypeChosen] = useState<"transfer" | "other" | null>(null);
  const tiedToTransfer = choices.find((choice) => choice.id === chosenId)?.kind === "transfer";
  const transferMode = typeChosen === null ? tiedToTransfer || chosenId === NEW_TRANSFER : typeChosen === "transfer";
  const billChoices = choices.filter((item) => item.kind !== "transfer");
  const transferChoices = choices.filter((item) => item.kind === "transfer");
  const itemOptions = [{ value: "", label: "None" }, ...billChoices.map((item) => ({ value: item.id, label: item.name }))];
  const transferOptions = [
    { value: "", label: "Choose one" },
    ...transferChoices.map((item) => ({ value: item.id, label: item.name })),
    { value: NEW_TRANSFER, label: "New transfer…" },
  ];
  /** Type changed: a bill can't stay chosen under Transfer, nor a transfer under Expense or Income. */
  function chooseType(type: (typeof typeOptions)[number]["value"]) {
    setTypeChosen(type === "transfer" ? "transfer" : "other");
    if (type !== "transfer") setValue("kind", type);
    const keep = type === "transfer" ? tiedToTransfer || chosenId === NEW_TRANSFER : !tiedToTransfer && chosenId !== NEW_TRANSFER;
    if (!keep) {
      setValue("billIncomeId", "");
      setValue("countsToward", "");
    }
  }

  const categories = useCategories();
  const createCategory = useCreateCategory();
  const chosenCategory = watch("categoryId");
  // Shown once the list has loaded, even with no categories yet: one can be made from here.
  const categoryOptions = [
    { value: "", label: "None" },
    ...(categories.data ?? []).map((category) => ({ value: category.id, label: category.name })),
    { value: NEW_CATEGORY, label: "New category…" },
  ];

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
    if (getValues("categoryId") === "" && item.categoryId) setValue("categoryId", item.categoryId);
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

  const onSubmit = handleSubmit(async ({ name, amount, kind, occursAt, note, paid, billIncomeId, countsToward, categoryId, newCategory, newTransfer }) => {
    setFormError(null);
    if (transferMode && billIncomeId === "") {
      setError("billIncomeId", { message: "Choose the account it moved between, or make a new one" });
      return;
    }
    const amountCents = parseAmount(amount) ?? 0;
    let tiedTo = billIncomeId === "" ? null : billIncomeId;
    if (billIncomeId === NEW_TRANSFER) {
      try {
        const { item } = await createTransfer.mutateAsync({
          name: newTransfer.trim(),
          description: "",
          kind: "transfer",
          openingCents: 0,
          defaultAmountCents: 0,
          recurrenceUnit: "none",
          recurrenceInterval: 1,
          endDate: null,
          categoryId: null,
        });
        tiedTo = item.id;
        // Made now, so a save that fails below doesn't make it twice when tried again.
        setValue("billIncomeId", item.id);
        setValue("newTransfer", "");
      } catch (error) {
        if (error instanceof ApiError && error.fields?.name) setError("newTransfer", { message: error.fields.name });
        else setFormError(error instanceof ApiError ? error.message : "Couldn't make that transfer. Try again.");
        return;
      }
    }
    let filedUnder = categoryId === "" ? null : categoryId;
    if (categoryId === NEW_CATEGORY) {
      try {
        const { category } = await createCategory.mutateAsync({ name: newCategory.trim(), defaultLimitCents: null });
        filedUnder = category.id;
        // Made now, so a save that fails below doesn't make it twice when tried again.
        setValue("categoryId", category.id);
        setValue("newCategory", "");
      } catch (error) {
        if (error instanceof ApiError && error.fields?.name) setError("newCategory", { message: error.fields.name });
        else setFormError(error instanceof ApiError ? error.message : "Couldn't make that category. Try again.");
        return;
      }
    }
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
                ...(filedUnder !== transaction.categoryId && { categoryId: filedUnder }),
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
              // Said outright once the list has loaded, so what the form shows is what is saved.
              // Until then it is left to the server, which files it where its bill or income is.
              ...(categories.data && { categoryId: filedUnder }),
              ...(countsToward !== "" && payable.some((entry) => entry.id === countsToward) && { countsToward }),
            }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.fields?.amountCents) {
        setError("amount", { message: error.fields.amountCents });
      }
      setFormError(
        applyApiError(error, setError, ["name", "occursAt", "note", "billIncomeId", "countsToward", "categoryId"]),
      );
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

  const saving = create.isPending || update.isPending || createCategory.isPending || createTransfer.isPending;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <TextField label="Name" autoComplete="off" data-autofocus error={errors.name?.message} {...register("name")} />

      {/* Three types need the width: side by side only from sm. */}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
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
            <SegmentedControl label="Type" options={typeOptions} value={transferMode ? "transfer" : field.value} onChange={chooseType} />
          )}
        />
      </div>

      {transferMode && (
        <>
          <SelectField
            label="Transfer"
            options={transferOptions}
            hint={chosenId === "" || chosenId === NEW_TRANSFER ? "Another account of your own: savings, joint, a loan." : transferHint}
            error={errors.billIncomeId?.message}
            {...itemField}
            onChange={(event) => {
              void itemField.onChange(event);
              choose(event.target.value);
            }}
          />
          {chosenId === NEW_TRANSFER && (
            <TextField
              label="New transfer name"
              autoComplete="off"
              maxLength={80}
              hint="It's added to Recurring as a transfer when you save."
              error={errors.newTransfer?.message}
              {...register("newTransfer")}
            />
          )}
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SegmentedControl label="Which way" options={directionOptions} value={field.value} onChange={field.onChange} />
            )}
          />
        </>
      )}

      <TextField
        label="Date and time"
        type="datetime-local"
        error={errors.occursAt?.message}
        {...register("occursAt")}
      />

      {!transferMode && billChoices.length > 0 && (
        <SelectField
          label="Recurring item"
          options={itemOptions}
          hint={chosenId === "" ? "Optional. Groups this with one of your recurring items." : undefined}
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

      {categories.data && (
        <SelectField
          label="Category"
          options={categoryOptions}
          error={errors.categoryId?.message}
          {...register("categoryId")}
        />
      )}
      {chosenCategory === NEW_CATEGORY && (
        <TextField
          label="New category name"
          autoComplete="off"
          maxLength={40}
          hint="It's added to your categories when you save."
          error={errors.newCategory?.message}
          {...register("newCategory")}
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

      {transaction && onFindLike && (
        <button
          type="button"
          onClick={() => onFindLike(transaction)}
          className="-my-1 inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Search className="size-4" aria-hidden />
          Find others like this
        </button>
      )}

      {linkedItem && (
        <button
          type="button"
          onClick={() => {
            onClose();
            void navigate(billOrIncomeDetailPath(linkedItem.id));
          }}
          className="-my-1 inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Repeat className="size-4" aria-hidden />
          Open {linkedItem.name} in Recurring
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
