import { z } from "zod";
import { diffDays, isLocalDate, isLocalDateTime, type LocalDate, type LocalDateTime } from "./dates.ts";

export const TRANSACTION_KINDS = ["expense", "income"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_STATUSES = ["upcoming", "paid"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const MAX_TRANSACTION_CENTS = 100_000_000; // $1,000,000.00

const nameSchema = z.string().trim().min(1, "Enter a name").max(100, "Keep the name under 100 characters");
const amountSchema = z
  .number("Enter an amount")
  .int("Enter a whole number of cents")
  .positive("Enter an amount greater than zero")
  .max(MAX_TRANSACTION_CENTS, "That amount is too large");
const kindSchema = z.enum(TRANSACTION_KINDS);
const occursAtSchema = z.string().refine(isLocalDateTime, "Enter a valid date and time");
const noteSchema = z.string().trim().max(500, "Keep the note under 500 characters");

export const transactionInputSchema = z.object({
  name: nameSchema,
  /** Always positive; `kind` says which way the money moves. */
  amountCents: amountSchema,
  kind: kindSchema,
  occursAt: occursAtSchema,
  note: noteSchema.optional(),
  /** Create it already marked as paid. */
  paid: z.boolean().optional(),
});
export type TransactionInput = z.output<typeof transactionInputSchema>;

export const transactionPatchSchema = z
  .object({
    name: nameSchema.optional(),
    amountCents: amountSchema.optional(),
    kind: kindSchema.optional(),
    occursAt: occursAtSchema.optional(),
    /** Empty or null clears the note. */
    note: noteSchema.nullable().optional(),
    status: z.enum(TRANSACTION_STATUSES).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");
export type TransactionPatch = z.output<typeof transactionPatchSchema>;

/** A new order for transactions that share the same date and time. */
export const transactionOrderSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Nothing to reorder")
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, "Each transaction may appear only once"),
});

export type Transaction = {
  id: string;
  name: string;
  /** Signed: negative for an expense, positive for income. */
  amountCents: number;
  kind: TransactionKind;
  occursAt: LocalDateTime;
  status: TransactionStatus;
  /** ISO instant it was marked paid, or null while upcoming. */
  paidAt: string | null;
  note: string | null;
  sortOrder: number;
  /** The recurring item it was generated from, or null for a one-off (or if that item was deleted). */
  recurringId: string | null;
};

/** The most days one request for transactions by date may cover, counting both ends. */
export const MAX_TRANSACTION_RANGE_DAYS = 366;

// Aborting keeps the comparisons below from running on something that isn't a date.
const rangeDateSchema = z.string("Enter a date").refine(isLocalDate, { message: "Enter a valid date", abort: true });

/** A span of calendar days, both ends included. */
export const transactionRangeSchema = z
  .object({ from: rangeDateSchema, to: rangeDateSchema })
  .refine(({ from, to }) => to >= from, { path: ["to"], message: "The end date is before the start date" })
  .refine(({ from, to }) => to < from || diffDays(from, to) < MAX_TRANSACTION_RANGE_DAYS, {
    path: ["to"],
    message: `Ask for ${MAX_TRANSACTION_RANGE_DAYS} days or fewer at a time`,
  });
export type TransactionRange = z.output<typeof transactionRangeSchema>;

export type TransactionListResponse = { transactions: Transaction[] };

/** Returned by create and update: the saved transaction and the period it now falls in. */
export type TransactionResponse = {
  transaction: Transaction;
  period: { id: string; startDate: LocalDate; endDate: LocalDate };
};
