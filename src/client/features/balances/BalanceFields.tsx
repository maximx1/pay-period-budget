import { useEffect } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { z } from "zod";
import { balanceSide, formatApr, parseAprInput } from "../../../shared/balances.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";

// The fields every balance form shares: the amount as a positive figure, which side of zero
// it is on, and the interest rate. Nobody has to type a minus for a debt.

export const balanceFieldsSchema = z.object({
  amount: z.string().refine((text) => parseMoneyInput(text) !== null, "Enter an amount like 1250.00"),
  side: z.enum(["owed", "held"]),
  apr: z.string().refine((text) => text.trim() === "" || parseAprInput(text) !== null, "Enter a rate like 24.99"),
});
export type BalanceFieldValues = z.infer<typeof balanceFieldsSchema>;

/**
 * Every balance form's values: the shared fields and the few some forms add. One type, so
 * the shared fields can take any of the forms.
 */
export const balanceFormSchema = balanceFieldsSchema.extend({
  /** Starting to track: which bill or transfer. */
  billIncomeId: z.string().optional(),
  /** Starting to track: "" for the account's interval, or a number of days. */
  every: z.string().optional(),
  /** A check in the history: the day it was, empty for now. */
  asOfDate: z.string().optional(),
});
export type BalanceFormValues = z.infer<typeof balanceFormSchema>;

/** The form's values as the API takes them. An empty rate is "no rate". */
export function balanceFieldsInput(values: BalanceFieldValues): { balanceCents: number; aprBps: number | null } {
  const cents = Math.abs(parseMoneyInput(values.amount) ?? 0);
  return {
    balanceCents: values.side === "owed" ? -cents : cents,
    aprBps: values.apr.trim() === "" ? null : parseAprInput(values.apr),
  };
}

/** Fills the fields from a balance: the amount left empty when `amount` is false, for a fresh reading. */
export function balanceFieldDefaults(balanceCents: number, aprBps: number | null, amount = true): BalanceFormValues {
  return {
    amount: amount ? centsToInput(Math.abs(balanceCents)) : "",
    side: balanceSide(balanceCents),
    apr: aprInput(aprBps),
  };
}

/** The APR field's text for a rate: "24.99", or empty for none. */
export const aprInput = (aprBps: number | null): string => (aprBps === null ? "" : formatApr(aprBps).replace("%", ""));

/**
 * Keeps a check form's APR on the last check's rate when that changes elsewhere (edited in
 * place, say), unless someone has typed one into it. Otherwise the next check would put the
 * old rate back.
 */
export function useFollowRate(form: UseFormReturn<BalanceFormValues>, aprBps: number | null): void {
  useEffect(() => {
    if (!form.getFieldState("apr").isDirty) form.resetField("apr", { defaultValue: aprInput(aprBps) });
  }, [form, aprBps]);
}

/** Puts the server's complaints about a check on the fields they belong to. Returns whether any did. */
export function applyBalanceErrors(error: unknown, form: UseFormReturn<BalanceFormValues>): boolean {
  const fields = error instanceof ApiError ? error.fields : undefined;
  if (fields?.balanceCents) form.setError("amount", { message: fields.balanceCents });
  if (fields?.aprBps) form.setError("apr", { message: fields.aprBps });
  return Boolean(fields?.balanceCents || fields?.aprBps);
}

const SIDES = [
  { value: "owed", label: "Owed" },
  { value: "held", label: "In it" },
] as const;

/**
 * Balance, owed or in it, and APR. `compact` lays them out in one row from `sm` up, for a
 * check inside a list.
 */
export function BalanceFields({
  form,
  compact = false,
  autoFocus = false,
  amountLabel = "Balance",
}: {
  // The callers' forms add fields of their own around these.
  form: UseFormReturn<BalanceFormValues>;
  compact?: boolean;
  autoFocus?: boolean;
  amountLabel?: string;
}) {
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = form;
  const side = useWatch({ control, name: "side" });

  return (
    <div className={compact ? "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_8rem] sm:items-start" : "flex flex-col gap-4"}>
      <TextField
        label={amountLabel}
        inputMode="decimal"
        autoComplete="off"
        data-autofocus={autoFocus || undefined}
        error={errors.amount?.message}
        {...register("amount")}
      />
      <SegmentedControl
        label="Owed or in it"
        options={SIDES}
        value={side}
        onChange={(value) => setValue("side", value, { shouldDirty: true })}
      />
      <TextField
        label="APR (optional)"
        inputMode="decimal"
        autoComplete="off"
        trailing={<span className="text-sm text-muted">%</span>}
        error={errors.apr?.message}
        {...register("apr")}
      />
    </div>
  );
}
