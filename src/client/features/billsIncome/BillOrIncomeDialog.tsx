import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { localDateSchema } from "../../../shared/budget.ts";
import { isLocalDate, todayIn } from "../../../shared/dates.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { describeRecurrence, RECURRENCE_UNITS, type RecurrenceUnit } from "../../../shared/recurrence.ts";
import {
  BILL_OR_INCOME_KINDS,
  END_BEFORE_START_MESSAGE,
  MAX_OPENING_CENTS,
  MAX_RECURRENCE_INTERVAL,
  type BillOrIncomeInput,
  type BillOrIncome,
  type BillOrIncomePreview,
} from "../../../shared/billsIncome.ts";
import { MAX_TRANSACTION_CENTS } from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextAreaField } from "../../components/ui/TextAreaField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";
import { applyApiError } from "../auth/formErrors.ts";
import { useCategories } from "../categories/api.ts";
import {
  useCreateBillOrIncome,
  useDeleteBillOrIncome,
  useEndBillOrIncome,
  useBillOrIncomePreview,
  useUpdateBillOrIncome,
} from "./api.ts";

const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

/** A transfer's starting balance: empty for none, and a minus for money owed. */
const parseOpening = (text: string) => {
  if (text.trim() === "") return 0;
  const cents = parseMoneyInput(text, { allowNegative: true });
  return cents !== null && Math.abs(cents) <= MAX_OPENING_CENTS ? cents : null;
};

const parseInterval = (text: string) => {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && value >= 1 && value <= MAX_RECURRENCE_INTERVAL ? value : null;
};

const formSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name under 80 characters"),
    kind: z.enum(BILL_OR_INCOME_KINDS),
    amount: z.string(),
    opening: z.string().refine((text) => parseOpening(text) !== null, "Enter an amount like 2500.00, or -2500.00 if it is owed"),
    recurrenceUnit: z.enum(RECURRENCE_UNITS),
    recurrenceInterval: z.string().refine((text) => parseInterval(text) !== null, `1 to ${MAX_RECURRENCE_INTERVAL}`),
    firstDueDate: localDateSchema,
    /** Empty means it never ends. */
    endDate: z.string().refine((text) => text === "" || isLocalDate(text), "Enter a valid date"),
    description: z.string().max(2000, "Keep the description under 2,000 characters"),
    /** The category its entries are filed under; empty for none. */
    categoryId: z.string(),
  })
  // Something with no schedule need not have a usual amount; anything that repeats must.
  .refine(
    (values) =>
      parseAmount(values.amount) !== null || (values.recurrenceUnit === "none" && values.amount.trim() === ""),
    { path: ["amount"], message: "Enter an amount like 60.00" },
  )
  .refine(
    (values) => values.recurrenceUnit === "none" || values.endDate === "" || values.endDate >= values.firstDueDate,
    { path: ["endDate"], message: END_BEFORE_START_MESSAGE },
  );
type FormValues = z.infer<typeof formSchema>;

const toInput = (values: FormValues): BillOrIncomeInput => {
  const noSchedule = values.recurrenceUnit === "none";
  return {
    name: values.name.trim(),
    kind: values.kind,
    defaultAmountCents: parseAmount(values.amount) ?? 0,
    // Only a transfer has a balance to start from.
    openingCents: values.kind === "transfer" ? (parseOpening(values.opening) ?? 0) : 0,
    recurrenceUnit: values.recurrenceUnit,
    // A pay-period item, or one with no schedule, has no interval to speak of; store the neutral value.
    recurrenceInterval:
      values.recurrenceUnit === "period" || noSchedule ? 1 : (parseInterval(values.recurrenceInterval) ?? 1),
    // With no schedule there is no first due date to give, and no end to a schedule either.
    firstDueDate: noSchedule ? undefined : values.firstDueDate,
    endDate: noSchedule || values.endDate === "" ? null : values.endDate,
    description: values.description.trim(),
    categoryId: values.categoryId === "" ? null : values.categoryId,
  };
};

const kindOptions = [
  { value: "expense", label: "Bill" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;

const editTitles = { expense: "Edit bill", income: "Edit income", transfer: "Edit transfer" } as const;

// Whether it has a schedule at all is asked first, and apart from how often it repeats.
const whenOptions = [
  { value: "schedule", label: "On a schedule" },
  { value: "none", label: "As it happens" },
] as const;

// Read as a sentence beside "Every 1": "Every 1 months".
const unitOptions = [
  { value: "month", label: "months" },
  { value: "week", label: "weeks" },
  { value: "year", label: "years" },
  { value: "period", label: "pay period" },
];

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Says what saving a new item will do to the periods that already exist. */
function PreviewNote({ preview }: { preview: BillOrIncomePreview }) {
  if (preview.transactions === 0) {
    return <p className="text-sm text-muted">Nothing to add yet. It will show up when its first period comes around.</p>;
  }
  if (preview.pastPeriods === 0) {
    return (
      <p className="text-sm text-muted">
        Adds {count(preview.transactions, "transaction")} to {count(preview.periods, "existing period")}.
      </p>
    );
  }
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning px-3 py-2.5 text-sm text-fg">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        Adds {count(preview.transactions, "transaction")} across {count(preview.periods, "period")},{" "}
        {preview.pastPeriods} of them already over. They will arrive unpaid, and the leftover carried through later
        periods will change.
      </p>
    </div>
  );
}

type BillOrIncomeDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The budget's time zone, for "today". */
  timezone: string;
  /** Present when editing; absent when adding. */
  item?: BillOrIncome;
};

export function BillOrIncomeDialog({ open, onClose, item, timezone }: BillOrIncomeDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? editTitles[item.kind] : "Add a recurring item"}
    >
      <BillOrIncomeForm onClose={onClose} item={item} timezone={timezone} />
    </Dialog>
  );
}

function BillOrIncomeForm({ onClose, item, timezone }: Omit<BillOrIncomeDialogProps, "open">) {
  const create = useCreateBillOrIncome();
  const update = useUpdateBillOrIncome();
  const remove = useDeleteBillOrIncome();
  const end = useEndBillOrIncome();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const [removeUpcoming, setRemoveUpcoming] = useState(true);
  const [applyToTransactions, setApplyToTransactions] = useState(false);
  const toast = useToast();
  const categories = useCategories();
  const categoryOptions = [
    { value: "", label: "None" },
    ...(categories.data ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];
  // What "On a schedule" goes back to after a look at "As it happens".
  const [scheduledUnit, setScheduledUnit] = useState<RecurrenceUnit>(
    item && item.recurrenceUnit !== "none" ? item.recurrenceUnit : "month",
  );
  const today = todayIn(timezone, new Date());

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: item
      ? {
          name: item.name,
          kind: item.kind,
          amount: item.defaultAmountCents === 0 ? "" : centsToInput(item.defaultAmountCents),
          opening: item.openingCents === 0 ? "" : `${item.openingCents < 0 ? "-" : ""}${centsToInput(item.openingCents)}`,
          recurrenceUnit: item.recurrenceUnit,
          recurrenceInterval: String(item.recurrenceInterval),
          // Without a schedule the stored date is only the day it was added; a schedule starts from today.
          firstDueDate: item.recurrenceUnit === "none" ? today : item.firstDueDate,
          endDate: item.endDate ?? "",
          description: item.description,
          categoryId: item.categoryId ?? "",
        }
      : {
          name: "",
          kind: "expense",
          amount: "",
          opening: "",
          recurrenceUnit: "month",
          recurrenceInterval: "1",
          firstDueDate: today,
          endDate: "",
          description: "",
          categoryId: "",
        },
  });

  const values = watch();
  const parsed = formSchema.safeParse(values);
  const everyPeriod = values.recurrenceUnit === "period";
  const noSchedule = values.recurrenceUnit === "none";
  const transfer = values.kind === "transfer";
  // Entries it adds from now on follow a change of category by themselves; whether the
  // transactions already tied to it should follow is asked.
  const categoryChanged = item !== undefined && values.categoryId !== (item.categoryId ?? "");
  // Neither has a number of weeks or months to ask for.
  const noInterval = everyPeriod || noSchedule;

  function chooseWhen(when: (typeof whenOptions)[number]["value"]) {
    if (when === "none" && !noSchedule) setScheduledUnit(values.recurrenceUnit);
    setValue("recurrenceUnit", when === "none" ? "none" : scheduledUnit, { shouldDirty: true });
  }

  // The schedule in words needs only the schedule fields to be valid, not the whole form.
  const interval = noInterval ? 1 : parseInterval(values.recurrenceInterval);
  const scheduleText =
    !noSchedule &&
    interval !== null &&
    isLocalDate(values.firstDueDate) &&
    (values.endDate === "" || isLocalDate(values.endDate))
      ? describeRecurrence({
          unit: values.recurrenceUnit,
          interval,
          firstDueDate: values.firstDueDate,
          endDate: values.endDate === "" ? null : values.endDate,
        })
      : null;

  // Only a new item adds transactions, so only then is there anything to preview.
  const previewInput = useDebouncedValue(!item && parsed.success ? JSON.stringify(toInput(parsed.data)) : null, 300);
  const preview = useBillOrIncomePreview(previewInput ? (JSON.parse(previewInput) as BillOrIncomeInput) : null);

  const onSubmit = handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      if (item) {
        const refile = categoryChanged && applyToTransactions;
        const { refiledTransactions } = await update.mutateAsync({
          id: item.id,
          patch: { ...toInput(submitted), ...(refile && { applyToTransactions: true }) },
        });
        if (refiledTransactions !== undefined) {
          const chosen = categories.data?.find((category) => category.id === submitted.categoryId)?.name;
          toast(
            `${count(refiledTransactions, "transaction")} ${chosen ? `filed under ${chosen}` : "left with no category"}.`,
          );
        }
      } else await create.mutateAsync(toInput(submitted));
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fields?.defaultAmountCents) {
        setError("amount", { message: error.fields.defaultAmountCents });
      }
      if (error instanceof ApiError && error.fields?.openingCents) {
        setError("opening", { message: error.fields.openingCents });
      }
      setFormError(
        applyApiError(error, setError, ["name", "recurrenceInterval", "firstDueDate", "endDate", "description", "categoryId"]),
      );
    }
  });

  async function confirm() {
    if (!item || !confirming) return;
    setFormError(null);
    try {
      if (confirming === "end") await end.mutateAsync({ id: item.id, removeUpcoming });
      else await remove.mutateAsync(item.id);
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "That didn't work. Try again.");
      setConfirming(null);
    }
  }

  const saving = create.isPending || update.isPending;
  const confirmBusy = end.isPending || remove.isPending;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <div>
        <SegmentedControl label="When" options={whenOptions} value={noSchedule ? "none" : "schedule"} onChange={chooseWhen} />
        {noSchedule && (
          <p className="mt-1.5 text-sm text-muted">Nothing is added by itself. Tie transactions to it as they happen.</p>
        )}
      </div>

      <TextField label="Name" autoComplete="off" data-autofocus error={errors.name?.message} {...register("name")} />

      <div>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <SegmentedControl label="Type" options={kindOptions} value={field.value} onChange={field.onChange} />
          )}
        />
        {transfer && (
          <p className="mt-1.5 text-sm text-muted">
            Money you move to another account of yours and may bring back: savings, a joint account, a loan.
          </p>
        )}
      </div>

      <div className={cn("grid grid-cols-1 items-start gap-3", transfer && "sm:grid-cols-2")}>
        <TextField
          label={noSchedule ? "Usual amount (optional)" : "Amount"}
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          error={errors.amount?.message}
          {...register("amount")}
        />
        {transfer && (
          <TextField
            label="Starting balance (optional)"
            placeholder="0.00"
            autoComplete="off"
            hint="What it held before the first transaction here. A minus for money owed."
            error={errors.opening?.message}
            {...register("opening")}
          />
        )}
      </div>

      {!noSchedule && (
        <div>
          <div className={cn("grid items-start gap-3", noInterval ? "grid-cols-1" : "grid-cols-[5.5rem_minmax(0,1fr)]")}>
            {!noInterval && (
              <TextField
                label="Every"
                inputMode="numeric"
                autoComplete="off"
                error={errors.recurrenceInterval?.message}
                {...register("recurrenceInterval")}
              />
            )}
            <SelectField
              label={everyPeriod ? "Repeats every" : "Repeats"}
              options={unitOptions}
              {...register("recurrenceUnit")}
            />
          </div>
          {scheduleText && <p className="mt-1.5 text-sm text-muted">{scheduleText}</p>}
        </div>
      )}

      {!noSchedule && (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <TextField
            label="First due date"
            type="date"
            error={errors.firstDueDate?.message}
            {...register("firstDueDate")}
          />
          <TextField label="Ends (optional)" type="date" error={errors.endDate?.message} {...register("endDate")} />
        </div>
      )}

      {categoryOptions.length > 1 && (
        <div>
          <SelectField
            label="Category"
            options={categoryOptions}
            hint="Optional. What it adds, and what is tied to it, is filed under this from now on."
            error={errors.categoryId?.message}
            {...register("categoryId")}
          />
          {categoryChanged && (
            <label className="mt-1 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-primary"
                checked={applyToTransactions}
                onChange={(event) => setApplyToTransactions(event.target.checked)}
              />
              <span>
                <span className="font-medium">
                  {values.categoryId === ""
                    ? "Also take the category off the transactions already tied to this"
                    : "Also set it on the transactions already tied to this"}
                </span>
                <span className="block text-muted">Every one of them, replacing any category they have now.</span>
              </span>
            </label>
          )}
        </div>
      )}

      <TextAreaField
        label="Description"
        hint="Notes, account numbers, a link to pay it."
        error={errors.description?.message}
        {...register("description")}
      />

      {item ? (
        !noSchedule && (
          <p className="text-sm text-muted">
            Changes apply to periods generated from now on. Existing transactions stay as they are.
          </p>
        )
      ) : (
        !noSchedule && preview.data && parsed.success && <PreviewNote preview={preview.data} />
      )}

      {confirming ? (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-sm font-medium text-fg">
            {confirming === "end"
              ? item?.recurrenceUnit === "none"
                ? `End ${item.name} today? It is archived from tomorrow.`
                : `End ${item?.name} today? It stops repeating and is archived from tomorrow.`
              : `Delete ${item?.name}? Transactions it already created stay where they are.`}
          </p>
          {confirming === "end" && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={removeUpcoming}
                onChange={(event) => setRemoveUpcoming(event.target.checked)}
              />
              Also remove its upcoming transactions
            </label>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={confirmBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={confirmBusy}>
              {confirming === "end" ? "End it" : "Delete"}
            </Button>
          </div>
        </div>
      ) : (
        <DialogActions>
          {item && (
            <div className="flex gap-2 sm:mr-auto">
              {!item.archived && (
                <Button variant="ghost" className="flex-1 text-danger" onClick={() => setConfirming("end")}>
                  End this
                </Button>
              )}
              <Button variant="ghost" className="flex-1 text-danger" onClick={() => setConfirming("delete")}>
                Delete
              </Button>
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {item ? "Save" : "Add"}
          </Button>
        </DialogActions>
      )}
    </form>
  );
}
