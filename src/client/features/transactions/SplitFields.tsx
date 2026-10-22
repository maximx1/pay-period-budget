import { Plus, X } from "lucide-react";
import { type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue, useFieldArray } from "react-hook-form";
import { dateOf, formatDateRange, formatDay, formatLongDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { laterTotal, MAX_SPLIT_ITEMS, MAX_SPLIT_LABEL, type SplitPayment, type TransactionSplitResponse } from "../../../shared/split.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { cn } from "../../lib/cn.ts";
import type { FormValues } from "./TransactionDialog.tsx";

const emptySplitItem = { label: "", amount: "", dueDate: "" };

type SplitItemsProps = {
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  /** What the preview found wrong with a field, by the server's name for it ("items.0.dueDate"). */
  previewErrors: Record<string, string>;
  /** The transaction's name, which becomes the first item's when a second is added. */
  name: string;
  /** Every item is named, even one alone: they join a split that already has some. */
  alwaysNamed?: boolean;
};

/** The amounts to split, each with the date it is due by. Several are each named, for the note. */
export function SplitItems({ control, register, setValue, errors, previewErrors, name, alwaysNamed = false }: SplitItemsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const several = fields.length > 1 || alwaysNamed;

  function addAnother() {
    // With one item its name is the transaction's; with two, each needs its own.
    if (!alwaysNamed && fields.length === 1 && !fields[0]!.label && name.trim()) {
      setValue("items.0.label", name.trim().slice(0, MAX_SPLIT_LABEL));
    }
    append(emptySplitItem, { focusName: `items.${fields.length}.label` });
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium text-fg">What to split</legend>
      {fields.map((field, index) => {
        const amountAndDate = (
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <TextField
              label="Amount"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              error={errors.items?.[index]?.amount?.message ?? previewErrors[`items.${index}.amountCents`]}
              {...register(`items.${index}.amount`)}
            />
            <TextField
              label="Due by"
              type="date"
              error={errors.items?.[index]?.dueDate?.message ?? previewErrors[`items.${index}.dueDate`]}
              {...register(`items.${index}.dueDate`)}
            />
          </div>
        );
        if (!several) return <div key={field.id}>{amountAndDate}</div>;
        return (
          <div key={field.id} className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  label="What it is"
                  autoComplete="off"
                  maxLength={MAX_SPLIT_LABEL}
                  placeholder="Laptop"
                  error={errors.items?.[index]?.label?.message ?? previewErrors[`items.${index}.label`]}
                  {...register(`items.${index}.label`)}
                />
              </div>
              {fields.length > 1 && (
                // Lined up with the field, below its label.
                <IconButton label={`Remove item ${index + 1}`} className="mt-6.5" onClick={() => remove(index)}>
                  <X className="size-5" aria-hidden />
                </IconButton>
              )}
            </div>
            {amountAndDate}
          </div>
        );
      })}
      {fields.length < MAX_SPLIT_ITEMS && (
        <Button variant="ghost" className="-my-1 self-start px-2 text-primary" onClick={addAnother}>
          <Plus className="size-4" aria-hidden />
          Add another
        </Button>
      )}
    </fieldset>
  );
}

type SplitPreviewProps = {
  /** The latest plan worked out, or undefined while there is none. */
  plan: Pick<TransactionSplitResponse, "payments" | "later"> | undefined;
  /** Says what the list is, in place of how many transactions it makes. */
  heading?: string;
  /** Why the plan can't be worked out, when the fields don't already say. */
  problem: string | null;
  /** The plan was refused over something a field now points out. */
  blocked: boolean;
  loading: boolean;
  /** Item names, in order, for the breakdown of each payment. Empty with one item. */
  labels: readonly string[];
};

/** The transactions the split will make, as the form stands. */
export function SplitPreview({ plan, heading, problem, blocked, loading, labels }: SplitPreviewProps) {
  if (problem) return <Alert>{problem}</Alert>;
  if (!plan) {
    return (
      <p className="text-sm text-muted">
        {loading
          ? "Working it out…"
          : blocked
            ? "Fix what's marked above to see the transactions it makes."
            : "Fill in each amount and due date to see the transactions it makes."}
      </p>
    );
  }

  const { payments, later } = plan;
  const first = dateOf(payments[0]!.occursAt);
  const last = dateOf(payments.at(-1)!.occursAt);
  return (
    <section aria-label="Transactions it makes" aria-busy={loading} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-fg">
        {heading ??
          (payments.length === 1
            ? `1 transaction, ${formatLongDate(first)}`
            : `${payments.length} transactions, ${formatDateRange(first, last)}`)}
      </h3>
      <PaymentList payments={payments} labels={labels} firstYear={first.slice(0, 4)} />
      {later.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-medium text-fg">Not added yet: {formatCents(laterTotal(plan))}</h3>
          <p className="text-sm text-muted">
            {later.length === 1 ? "This payment falls" : `These ${later.length} payments fall`} more than a year ahead,
            past the last pay period that can be made now. {later.length === 1 ? "It waits" : "They wait"} under
            Split payments, and the home screen says when {later.length === 1 ? "it" : "they"} can be added.
          </p>
          <PaymentList payments={later} labels={labels} firstYear={first.slice(0, 4)} muted />
        </>
      )}
    </section>
  );
}

type PaymentListProps = {
  payments: readonly SplitPayment[];
  labels: readonly string[];
  /** The first payment's year: a date in any other year shows its own. */
  firstYear: string;
  muted?: boolean;
};

/** Payments a split makes, each with its date, amount and (with several items) what each makes up of it. */
export function PaymentList({ payments, labels, firstYear, muted }: PaymentListProps) {
  return (
    <ol className={cn("divide-y divide-border rounded-xl border border-border", muted && "border-dashed")}>
      {payments.map((payment) => (
        <li key={payment.occursAt} className="flex flex-col gap-0.5 px-3 py-2">
          <div className={cn("flex items-baseline justify-between gap-3 text-sm", muted ? "text-muted" : "text-fg")}>
            <span>
              {formatDay(dateOf(payment.occursAt))}
              {payment.occursAt.slice(0, 4) !== firstYear && `, ${payment.occursAt.slice(0, 4)}`}
            </span>
            <span className="font-medium tabular-nums">{formatCents(payment.amountCents)}</span>
          </div>
          {labels.length > 1 && (
            <p className="text-xs break-words text-muted">
              {payment.shares.map(({ item, cents }) => `${labels[item]} ${formatCents(cents)}`).join(" + ")}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
