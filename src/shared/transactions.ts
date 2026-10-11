import { z } from "zod";
import { isLocalDateTime, type LocalDate, type LocalDateTime } from "./dates.ts";

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
};

/** Returned by create and update: the saved transaction and the period it now falls in. */
export type TransactionResponse = {
  transaction: Transaction;
  period: { id: string; startDate: LocalDate; endDate: LocalDate };
};
