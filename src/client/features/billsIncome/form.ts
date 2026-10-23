import { z } from "zod";
import { isLocalDate } from "../../../shared/dates.ts";
import { parseMoneyInput } from "../../../shared/money.ts";
import { DUE_UNITS } from "../../../shared/dueDates.ts";
import { RECURRENCE_UNITS, type RecurrenceUnit } from "../../../shared/recurrence.ts";
import {
  BILL_OR_INCOME_KINDS,
  canHaveDueDate,
  END_BEFORE_START_MESSAGE,
  MAX_OPENING_CENTS,
  MAX_RECURRENCE_INTERVAL,
  type BillOrIncomeInput,
  type BillOrIncomeKind,
} from "../../../shared/billsIncome.ts";
import { MAX_TRANSACTION_CENTS } from "../../../shared/transactions.ts";

export const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

/** A transfer's starting balance: empty for none, and a minus for money owed. */
export const parseOpening = (text: string) => {
  if (text.trim() === "") return 0;
  const cents = parseMoneyInput(text, { allowNegative: true });
  return cents !== null && Math.abs(cents) <= MAX_OPENING_CENTS ? cents : null;
};

export const parseInterval = (text: string) => {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && value >= 1 && value <= MAX_RECURRENCE_INTERVAL ? value : null;
};

/** Neither has a number of weeks or months to ask for. */
export const hasInterval = (unit: RecurrenceUnit) => unit !== "period" && unit !== "none";

/** A due date is asked for only on something paid out, and only once the box is ticked. */
export function tracksDue(values: { hasDue: boolean; kind: BillOrIncomeKind }): boolean {
  return values.hasDue && canHaveDueDate(values.kind);
}

// Every field is checked only while the form shows it. Switching to "As it happens", to a
// pay-period schedule or away from a transfer hides fields that may still hold something
// invalid, and an error on a field nobody can see blocks saving with nothing to say why.
export const formSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name under 80 characters"),
    kind: z.enum(BILL_OR_INCOME_KINDS),
    amount: z.string(),
    opening: z.string(),
    recurrenceUnit: z.enum(RECURRENCE_UNITS),
    recurrenceInterval: z.string(),
    firstDueDate: z.string(),
    /** Empty means it never ends. */
    endDate: z.string(),
    description: z.string().max(2000, "Keep the description under 2,000 characters"),
    /** The category its entries are filed under; empty for none. */
    categoryId: z.string(),
    /** Whether to warn when nothing is set to pay it by its due date. Ignored for an income. */
    hasDue: z.boolean(),
    dueDate: z.string(),
    dueUnit: z.enum(DUE_UNITS),
    dueInterval: z.string(),
  })
  // Something with no schedule need not have a usual amount (empty or 0); anything that repeats must.
  .refine(
    (values) =>
      parseAmount(values.amount) !== null ||
      (values.recurrenceUnit === "none" && (values.amount.trim() === "" || parseMoneyInput(values.amount) === 0)),
    { path: ["amount"], message: "Enter an amount like 60.00" },
  )
  .refine((values) => values.kind !== "transfer" || parseOpening(values.opening) !== null, {
    path: ["opening"],
    message: "Enter an amount like 2500.00, or -2500.00 if it is owed",
  })
  .refine((values) => !hasInterval(values.recurrenceUnit) || parseInterval(values.recurrenceInterval) !== null, {
    path: ["recurrenceInterval"],
    message: `1 to ${MAX_RECURRENCE_INTERVAL}`,
  })
  .refine((values) => values.recurrenceUnit === "none" || isLocalDate(values.firstDueDate), {
    path: ["firstDueDate"],
    message: "Enter a valid date",
  })
  .refine((values) => values.recurrenceUnit === "none" || values.endDate === "" || isLocalDate(values.endDate), {
    path: ["endDate"],
    message: "Enter a valid date",
  })
  .refine(
    (values) => values.recurrenceUnit === "none" || values.endDate === "" || values.endDate >= values.firstDueDate,
    { path: ["endDate"], message: END_BEFORE_START_MESSAGE },
  )
  .refine((values) => !tracksDue(values) || isLocalDate(values.dueDate), { path: ["dueDate"], message: "Enter a valid date" })
  .refine((values) => !tracksDue(values) || parseInterval(values.dueInterval) !== null, {
    path: ["dueInterval"],
    message: `1 to ${MAX_RECURRENCE_INTERVAL}`,
  });
export type FormValues = z.infer<typeof formSchema>;

export const toInput = (values: FormValues): BillOrIncomeInput => {
  const noSchedule = values.recurrenceUnit === "none";
  return {
    name: values.name.trim(),
    kind: values.kind,
    defaultAmountCents: parseAmount(values.amount) ?? 0,
    // Only a transfer has a balance to start from.
    openingCents: values.kind === "transfer" ? (parseOpening(values.opening) ?? 0) : 0,
    recurrenceUnit: values.recurrenceUnit,
    // A pay-period item, or one with no schedule, has no interval to speak of; store the neutral value.
    recurrenceInterval: hasInterval(values.recurrenceUnit) ? (parseInterval(values.recurrenceInterval) ?? 1) : 1,
    // With no schedule there is no first due date to give, and no end to a schedule either.
    firstDueDate: noSchedule ? undefined : values.firstDueDate,
    endDate: noSchedule || values.endDate === "" ? null : values.endDate,
    description: values.description.trim(),
    categoryId: values.categoryId === "" ? null : values.categoryId,
    dueDate: tracksDue(values) ? values.dueDate : null,
    dueUnit: values.dueUnit,
    dueInterval: parseInterval(values.dueInterval) ?? 1,
  };
};
