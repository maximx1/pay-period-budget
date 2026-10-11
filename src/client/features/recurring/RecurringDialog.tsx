import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { localDateSchema } from "../../../shared/budget.ts";
import { isLocalDate, todayIn } from "../../../shared/dates.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { describeRecurrence, RECURRENCE_UNITS } from "../../../shared/recurrence.ts";
import {
  END_BEFORE_START_MESSAGE,
  MAX_RECURRENCE_INTERVAL,
  type RecurringInput,
  type RecurringItem,
  type RecurringPreview,
} from "../../../shared/recurring.ts";
import { MAX_TRANSACTION_CENTS, TRANSACTION_KINDS } from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextAreaField } from "../../components/ui/TextAreaField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";
import { applyApiError } from "../auth/formErrors.ts";
import {
  useCreateRecurring,
  useDeleteRecurring,
  useEndRecurring,
  useRecurringPreview,
  useUpdateRecurring,
} from "./api.ts";

const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

const parseInterval = (text: string) => {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && value >= 1 && value <= MAX_RECURRENCE_INTERVAL ? value : null;
};

const formSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name under 80 characters"),
    kind: z.enum(TRANSACTION_KINDS),
    amount: z.string().refine((text) => parseAmount(text) !== null, "Enter an amount like 60.00"),
    recurrenceUnit: z.enum(RECURRENCE_UNITS),
    recurrenceInterval: z.string().refine((text) => parseInterval(text) !== null, `1 to ${MAX_RECURRENCE_INTERVAL}`),
    firstDueDate: localDateSchema,
    /** Empty means it never ends. */
    endDate: z.string().refine((text) => text === "" || isLocalDate(text), "Enter a valid date"),
    description: z.string().max(2000, "Keep the description under 2,000 characters"),
  })
  .refine((values) => values.endDate === "" || values.endDate >= values.firstDueDate, {
    path: ["endDate"],
    message: END_BEFORE_START_MESSAGE,
  });
type FormValues = z.infer<typeof formSchema>;

const toInput = (values: FormValues): RecurringInput => ({
  name: values.name.trim(),
  kind: values.kind,
  defaultAmountCents: parseAmount(values.amount) ?? 0,
  recurrenceUnit: values.recurrenceUnit,
  // A pay-period item has no interval to speak of; store the neutral value.
  recurrenceInterval: values.recurrenceUnit === "period" ? 1 : (parseInterval(values.recurrenceInterval) ?? 1),
  firstDueDate: values.firstDueDate,
  endDate: values.endDate === "" ? null : values.endDate,
  description: values.description.trim(),
});

const kindOptions = [
  { value: "expense", label: "Bill" },
  { value: "income", label: "Income" },
] as const;

const unitOptions = [
  { value: "month", label: "months" },
  { value: "week", label: "weeks" },
  { value: "year", label: "years" },
  { value: "period", label: "pay period" },
];

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Says what saving a new item will do to the periods that already exist. */
function PreviewNote({ preview }: { preview: RecurringPreview }) {
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

type RecurringDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The budget's time zone, for "today". */
  timezone: string;
  /** Present when editing; absent when adding. */
  item?: RecurringItem;
};

export function RecurringDialog({ open, onClose, item, timezone }: RecurringDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={item ? "Edit recurring item" : "Add recurring item"}>
      <RecurringForm onClose={onClose} item={item} timezone={timezone} />
    </Dialog>
  );
}

function RecurringForm({ onClose, item, timezone }: Omit<RecurringDialogProps, "open">) {
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const end = useEndRecurring();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const [removeUpcoming, setRemoveUpcoming] = useState(true);

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: item
      ? {
          name: item.name,
          kind: item.kind,
          amount: centsToInput(item.defaultAmountCents),
          recurrenceUnit: item.recurrenceUnit,
          recurrenceInterval: String(item.recurrenceInterval),
          firstDueDate: item.firstDueDate,
          endDate: item.endDate ?? "",
          description: item.description,
        }
      : {
          name: "",
          kind: "expense",
          amount: "",
          recurrenceUnit: "month",
          recurrenceInterval: "1",
          firstDueDate: todayIn(timezone, new Date()),
          endDate: "",
          description: "",
        },
  });

  const values = watch();
  const parsed = formSchema.safeParse(values);
  const everyPeriod = values.recurrenceUnit === "period";

  // The schedule in words needs only the schedule fields to be valid, not the whole form.
  const interval = everyPeriod ? 1 : parseInterval(values.recurrenceInterval);
  const scheduleText =
    interval !== null && isLocalDate(values.firstDueDate) && (values.endDate === "" || isLocalDate(values.endDate))
      ? describeRecurrence({
          unit: values.recurrenceUnit,
          interval,
          firstDueDate: values.firstDueDate,
          endDate: values.endDate === "" ? null : values.endDate,
        })
      : null;

  // Only a new item adds transactions, so only then is there anything to preview.
  const previewInput = useDebouncedValue(!item && parsed.success ? JSON.stringify(toInput(parsed.data)) : null, 300);
  const preview = useRecurringPreview(previewInput ? (JSON.parse(previewInput) as RecurringInput) : null);

  const onSubmit = handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      if (item) await update.mutateAsync({ id: item.id, patch: toInput(submitted) });
      else await create.mutateAsync(toInput(submitted));
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fields?.defaultAmountCents) {
        setError("amount", { message: error.fields.defaultAmountCents });
      }
      setFormError(
        applyApiError(error, setError, ["name", "recurrenceInterval", "firstDueDate", "endDate", "description"]),
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

      <div>
        <div className={cn("grid items-start gap-3", everyPeriod ? "grid-cols-1" : "grid-cols-[5.5rem_minmax(0,1fr)]")}>
          {!everyPeriod && (
            <TextField
              label="Every"
              inputMode="numeric"
              autoComplete="off"
              error={errors.recurrenceInterval?.message}
              {...register("recurrenceInterval")}
            />
          )}
          <SelectField label={everyPeriod ? "Repeats every" : "Repeats"} options={unitOptions} {...register("recurrenceUnit")} />
        </div>
        {scheduleText && <p className="mt-1.5 text-sm text-muted">{scheduleText}</p>}
      </div>

      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <TextField
          label="First due date"
          type="date"
          error={errors.firstDueDate?.message}
          {...register("firstDueDate")}
        />
        <TextField label="Ends (optional)" type="date" error={errors.endDate?.message} {...register("endDate")} />
      </div>

      <TextAreaField
        label="Description"
        hint="Notes, account numbers, a link to pay it."
        error={errors.description?.message}
        {...register("description")}
      />

      {item ? (
        <p className="text-sm text-muted">
          Changes apply to periods generated from now on. Existing transactions stay as they are.
        </p>
      ) : (
        preview.data && parsed.success && <PreviewNote preview={preview.data} />
      )}

      {confirming ? (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-sm font-medium text-fg">
            {confirming === "end"
              ? `End ${item?.name} today? It stops repeating and is archived from tomorrow.`
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
