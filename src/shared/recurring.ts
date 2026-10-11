import { z } from "zod";
import { localDateSchema } from "./budget.ts";
import type { LocalDate } from "./dates.ts";
import { RECURRENCE_UNITS, type RecurrenceUnit } from "./recurrence.ts";
import { MAX_TRANSACTION_CENTS, TRANSACTION_KINDS, type TransactionKind } from "./transactions.ts";

export const MAX_RECURRENCE_INTERVAL = 52;

// Plain field rules, shared by the create and patch schemas below. Defaults live only on
// the create schema: a patch must never fill in a field the caller didn't send.
const fields = {
  name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name under 80 characters"),
  description: z.string().trim().max(2000, "Keep the description under 2,000 characters"),
  kind: z.enum(TRANSACTION_KINDS),
  /** Always positive; `kind` says which way the money moves. */
  defaultAmountCents: z
    .number("Enter an amount")
    .int("Enter a whole number of cents")
    .positive("Enter an amount greater than zero")
    .max(MAX_TRANSACTION_CENTS, "That amount is too large"),
  recurrenceUnit: z.enum(RECURRENCE_UNITS),
  recurrenceInterval: z
    .number("Enter a number")
    .int("Enter a whole number")
    .min(1, "Must be at least 1")
    .max(MAX_RECURRENCE_INTERVAL, `Must be ${MAX_RECURRENCE_INTERVAL} or less`),
  firstDueDate: localDateSchema,
  endDate: localDateSchema.nullable(),
};

export const END_BEFORE_START_MESSAGE = "Must be on or after the first due date";

export const recurringInputSchema = z
  .object({
    ...fields,
    description: fields.description.default(""),
    recurrenceInterval: fields.recurrenceInterval.default(1),
    endDate: fields.endDate.default(null),
  })
  .refine((item) => item.endDate === null || item.endDate >= item.firstDueDate, {
    path: ["endDate"],
    message: END_BEFORE_START_MESSAGE,
  });
export type RecurringInput = z.output<typeof recurringInputSchema>;

/** Any subset of the fields. The end date is checked against the first due date after merging. */
export const recurringPatchSchema = z
  .object({
    name: fields.name.optional(),
    description: fields.description.optional(),
    kind: fields.kind.optional(),
    defaultAmountCents: fields.defaultAmountCents.optional(),
    recurrenceUnit: fields.recurrenceUnit.optional(),
    recurrenceInterval: fields.recurrenceInterval.optional(),
    firstDueDate: fields.firstDueDate.optional(),
    endDate: fields.endDate.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");
export type RecurringPatch = z.output<typeof recurringPatchSchema>;

export const endRecurringSchema = z.object({
  /** Also delete its upcoming transactions dated after today. */
  removeUpcoming: z.boolean(),
});

export type RecurringItem = {
  id: string;
  name: string;
  description: string;
  kind: TransactionKind;
  defaultAmountCents: number;
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  firstDueDate: LocalDate;
  endDate: LocalDate | null;
  /** Its end date has passed; it produces nothing further. */
  archived: boolean;
  /** Next occurrence from today on, when it can be known ahead of time. */
  nextDueDate: LocalDate | null;
  /** The schedule in words, e.g. "Every month on the 25th". */
  scheduleText: string;
};

export type RecurringListResponse = { items: RecurringItem[] };
export type RecurringResponse = { item: RecurringItem };

/** What creating an item would add to the periods that already exist. */
export type RecurringPreview = {
  transactions: number;
  periods: number;
  /** How many of those periods ended before today. */
  pastPeriods: number;
  earliestDate: LocalDate | null;
};
