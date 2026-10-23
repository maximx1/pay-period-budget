import { Plus, Split, X } from "lucide-react";
import { useEffect } from "react";
import { type UseFormReturn, useFieldArray, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  type BalancePartInput,
  balanceSide,
  formatApr,
  MAX_PARTS,
  parseAprInput,
  type TrackedBalance,
} from "../../../shared/balances.ts";
import { formatCents, parseMoneyInput } from "../../../shared/money.ts";
import { Button } from "../../components/ui/Button.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";

// The fields every balance form shares: the amount as a positive figure, which side of zero
// it is on, and the interest rate; or, for a balance in parts (phase 32), a name, amount and
// rate for each part, all on one side. Nobody has to type a minus for a debt.

const AMOUNT_MESSAGE = "Enter an amount like 1250.00";
const APR_MESSAGE = "Enter a rate like 24.99";
const isAmount = (text: string) => parseMoneyInput(text) !== null;
const isApr = (text: string) => text.trim() === "" || parseAprInput(text) !== null;

export const balanceFieldsSchema = z.object({
  amount: z.string().refine(isAmount, AMOUNT_MESSAGE),
  side: z.enum(["owed", "held"]),
  apr: z.string().refine(isApr, APR_MESSAGE),
});

export const partFieldsSchema = z.object({
  /** The part's id, for one the balance already has. */
  partId: z.string().optional(),
  name: z.string().trim().min(1, "Give it a name").max(60, "Keep it to 60 characters"),
  amount: z.string().refine(isAmount, AMOUNT_MESSAGE),
  apr: z.string().refine(isApr, APR_MESSAGE),
});

/**
 * Every balance form's values: the shared fields and the few some forms add. One type, so
 * the shared fields can take any of the forms. With parts, `amount` and `apr` are not used.
 */
export const balanceFormSchema = z
  .object({
    amount: z.string(),
    side: z.enum(["owed", "held"]),
    apr: z.string().refine(isApr, APR_MESSAGE),
    /** Empty: one balance. */
    parts: z.array(partFieldsSchema).max(MAX_PARTS),
    /** Starting to track: which bill or transfer. */
    billIncomeId: z.string().optional(),
    /** Starting to track: "" for the account's interval, or a number of days. */
    every: z.string().optional(),
    /** A check in the history: the day it was, empty for now. */
    asOfDate: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.parts.length === 0) {
      if (!isAmount(values.amount)) ctx.addIssue({ code: "custom", path: ["amount"], message: AMOUNT_MESSAGE });
      return;
    }
    const seen = new Set<string>();
    values.parts.forEach((part, index) => {
      const key = part.name.trim().toLowerCase();
      if (key && seen.has(key)) ctx.addIssue({ code: "custom", path: ["parts", index, "name"], message: "Another part has this name" });
      seen.add(key);
    });
  });
export type BalanceFormValues = z.infer<typeof balanceFormSchema>;

/** A form for a balance no one has read yet: one figure, owed. */
export const blankBalanceFields = { amount: "", side: "owed", apr: "", parts: [] } satisfies Partial<BalanceFormValues>;

/**
 * The form's values as the API takes them. An empty rate is "no rate". Without parts it
 * says so (`parts: []`), which is also how a balance stops being in parts.
 */
export function balanceFieldsInput(
  values: Pick<BalanceFormValues, "amount" | "side" | "apr" | "parts">,
): { balanceCents: number; aprBps: number | null; parts: [] } | { parts: BalancePartInput[] } {
  const signed = (text: string) => {
    const cents = Math.abs(parseMoneyInput(text) ?? 0);
    return values.side === "owed" ? -cents : cents;
  };
  const rate = (text: string) => (text.trim() === "" ? null : parseAprInput(text));
  if (values.parts.length === 0) return { balanceCents: signed(values.amount), aprBps: rate(values.apr), parts: [] };
  return {
    parts: values.parts.map((part) => ({
      ...(part.partId && { id: part.partId }),
      name: part.name.trim(),
      balanceCents: signed(part.amount),
      aprBps: rate(part.apr),
    })),
  };
}

/** A fresh reading of a tracked balance: the amounts empty, the side, rates and parts as they were. */
export function checkDefaults(balance: TrackedBalance): BalanceFormValues {
  return {
    amount: "",
    side: balanceSide(balance.estimateCents),
    apr: aprInput(balance.lastCheck.aprBps),
    parts: balance.parts.map((part) => ({ partId: part.id, name: part.name, amount: "", apr: aprInput(part.aprBps) })),
  };
}

/** The APR field's text for a rate: "24.99", or empty for none. */
export const aprInput = (aprBps: number | null): string => (aprBps === null ? "" : formatApr(aprBps).replace("%", ""));

/**
 * Keeps a check form's rates (and its parts' names) on the last check's when those change
 * elsewhere (edited in place, say), unless someone has typed into them. Otherwise the next
 * check would put the old ones back.
 */
export function useFollowRates(form: UseFormReturn<BalanceFormValues>, balance: TrackedBalance): void {
  const shown = [balance.lastCheck.aprBps, ...balance.parts.map((part) => `${part.id}:${part.aprBps}:${part.name}`)].join("|");
  useEffect(() => {
    if (!form.getFieldState("apr").isDirty) form.resetField("apr", { defaultValue: aprInput(balance.lastCheck.aprBps) });
    form.getValues("parts").forEach((part, index) => {
      const now = balance.parts.find((candidate) => candidate.id === part.partId);
      if (!now) return;
      if (!form.getFieldState(`parts.${index}.apr`).isDirty) form.resetField(`parts.${index}.apr`, { defaultValue: aprInput(now.aprBps) });
      if (!form.getFieldState(`parts.${index}.name`).isDirty) form.resetField(`parts.${index}.name`, { defaultValue: now.name });
    });
    // `shown` stands for what of the balance this reads.
  }, [form, shown]);
}

const PART_FIELDS: Record<string, "name" | "amount" | "apr"> = { name: "name", id: "name", balanceCents: "amount", aprBps: "apr" };

/** Puts the server's complaints about a check on the fields they belong to. Returns whether any did. */
export function applyBalanceErrors(error: unknown, form: UseFormReturn<BalanceFormValues>): boolean {
  const fields = error instanceof ApiError ? error.fields : undefined;
  let placed = false;
  for (const [key, message] of Object.entries(fields ?? {})) {
    const part = /^parts\.(\d+)\.(\w+)$/.exec(key);
    if (key === "balanceCents") form.setError("amount", { message });
    else if (key === "aprBps") form.setError("apr", { message });
    else if (key === "parts") form.setError("root.parts", { message });
    else if (part && PART_FIELDS[part[2]!]) form.setError(`parts.${Number(part[1])}.${PART_FIELDS[part[2]!]!}`, { message });
    else continue;
    placed = true;
  }
  return placed;
}

const SIDES = [
  { value: "owed", label: "Owed" },
  { value: "held", label: "In it" },
] as const;

/**
 * Balance, owed or in it, and APR; or the same for each part. `compact` lays the single
 * balance out in one row from `sm` up, for a check inside a list.
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
    getValues,
    control,
    formState: { errors },
  } = form;
  const side = useWatch({ control, name: "side" });
  const parts = useWatch({ control, name: "parts" });
  const { fields, append, remove } = useFieldArray({ control, name: "parts" });

  const sides = (
    <SegmentedControl
      label="Owed or in it"
      options={SIDES}
      value={side}
      onChange={(value) => setValue("side", value, { shouldDirty: true })}
    />
  );
  const aprField = (name: "apr" | `parts.${number}.apr`, error: string | undefined, label = "APR (optional)") => (
    <TextField
      label={label}
      inputMode="decimal"
      autoComplete="off"
      trailing={<span className="text-sm text-muted">%</span>}
      error={error}
      {...register(name)}
    />
  );

  if (fields.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className={compact ? "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_8rem] sm:items-start" : "flex flex-col gap-4"}>
          <TextField
            label={amountLabel}
            inputMode="decimal"
            autoComplete="off"
            data-autofocus={autoFocus || undefined}
            error={errors.amount?.message}
            {...register("amount")}
          />
          {sides}
          {aprField("apr", errors.apr?.message)}
        </div>
        <Button
          variant="ghost"
          className="self-start"
          // The figure and rate typed so far become the first part's.
          onClick={() => append([{ name: "", amount: getValues("amount"), apr: getValues("apr") }, { name: "", amount: "", apr: getValues("apr") }])}
        >
          <Split className="size-4" aria-hidden />
          Split into parts
        </Button>
      </div>
    );
  }

  const total = parts.reduce((sum, part) => sum + Math.abs(parseMoneyInput(part.amount) ?? 0), 0);
  return (
    <div className="flex flex-col gap-3">
      {sides}
      <ul className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const partErrors = errors.parts?.[index];
          const name = parts[index]?.name.trim();
          return (
            <li key={field.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-3 rounded-lg border border-border p-3">
              <TextField
                label={`Part ${index + 1}`}
                autoComplete="off"
                placeholder="Its name, like 1-01"
                error={partErrors?.name?.message}
                {...register(`parts.${index}.name`)}
              />
              <IconButton
                label={`Remove ${name || `part ${index + 1}`}`}
                className="mt-6.5"
                onClick={() => {
                  // The last part gone, its figure is the balance again.
                  if (fields.length === 1) setValue("amount", getValues(`parts.${index}.amount`));
                  remove(index);
                }}
              >
                <X className="size-4" aria-hidden />
              </IconButton>
              <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-3">
                <TextField
                  label={amountLabel}
                  inputMode="decimal"
                  autoComplete="off"
                  data-autofocus={(autoFocus && index === 0) || undefined}
                  error={partErrors?.amount?.message}
                  {...register(`parts.${index}.amount`)}
                />
                {aprField(`parts.${index}.apr`, partErrors?.apr?.message, "APR")}
              </div>
            </li>
          );
        })}
      </ul>
      {errors.root?.parts && <p className="text-sm text-danger">{errors.root.parts.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          disabled={fields.length >= MAX_PARTS}
          onClick={() => append({ name: "", amount: "", apr: "" })}
        >
          <Plus className="size-4" aria-hidden />
          Add a part
        </Button>
        <p className="text-sm text-muted tabular-nums">
          Total {formatCents(total)} {side === "owed" ? "owed" : "in it"}
        </p>
      </div>
    </div>
  );
}
