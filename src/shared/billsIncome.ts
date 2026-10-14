import { z } from "zod";
import { localDateSchema } from "./budget.ts";
import type { LocalDate } from "./dates.ts";
import { RECURRENCE_UNITS, type RecurrenceUnit } from "./recurrence.ts";
import { MAX_TRANSACTION_CENTS, type Transaction, type TransactionKind } from "./transactions.ts";

/**
 * A bill is money out and an income is money in. A transfer is money moved to another
 * account of your own (savings, a joint account, a loan), which may come back: its
 * transactions go either way, and it has a balance worked out from them.
 */
export const BILL_OR_INCOME_KINDS = ["expense", "income", "transfer"] as const;
export type BillOrIncomeKind = (typeof BILL_OR_INCOME_KINDS)[number];

/**
 * Which way an item's own entries go: the ones its schedule adds, and what choosing it for
 * a new transaction suggests. A transfer's own direction is money out; bringing money back
 * is always entered by hand.
 */
export const entryKindOf = (kind: BillOrIncomeKind): TransactionKind => (kind === "income" ? "income" : "expense");

export const MAX_RECURRENCE_INTERVAL = 52;
/** The most a transfer's starting balance may be, either side of zero. */
export const MAX_OPENING_CENTS = 1_000_000_000; // $10,000,000.00
export const OPENING_ONLY_FOR_TRANSFER_MESSAGE = "Only a transfer has a starting balance";
export const AMOUNT_NEEDED_MESSAGE = "Enter an amount greater than zero";
export const FIRST_DUE_NEEDED_MESSAGE = "Enter the first due date";

// Plain field rules, shared by the create and patch schemas below. Defaults live only on
// the create schema: a patch must never fill in a field the caller didn't send.
const fields = {
  name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name under 80 characters"),
  description: z.string().trim().max(2000, "Keep the description under 2,000 characters"),
  kind: z.enum(BILL_OR_INCOME_KINDS),
  /**
   * What the other account held before its first transaction here: signed, negative for
   * money owed (a loan). Only a transfer has one.
   */
  openingCents: z
    .number("Enter an amount")
    .int("Enter a whole number of cents")
    .min(-MAX_OPENING_CENTS, "That amount is too large")
    .max(MAX_OPENING_CENTS, "That amount is too large"),
  /**
   * Never negative; `kind` says which way the money moves. 0 means "no usual amount" and is
   * allowed only for an item with no schedule.
   */
  defaultAmountCents: z
    .number("Enter an amount")
    .int("Enter a whole number of cents")
    .min(0, AMOUNT_NEEDED_MESSAGE)
    .max(MAX_TRANSACTION_CENTS, "That amount is too large"),
  recurrenceUnit: z.enum(RECURRENCE_UNITS),
  recurrenceInterval: z
    .number("Enter a number")
    .int("Enter a whole number")
    .min(1, "Must be at least 1")
    .max(MAX_RECURRENCE_INTERVAL, `Must be ${MAX_RECURRENCE_INTERVAL} or less`),
  firstDueDate: localDateSchema,
  endDate: localDateSchema.nullable(),
  /** The category its entries are filed under as they are added. */
  categoryId: z.string().min(1).max(100).nullable(),
};

export const END_BEFORE_START_MESSAGE = "Must be on or after the first due date";

export const billOrIncomeInputSchema = z
  .object({
    ...fields,
    description: fields.description.default(""),
    recurrenceInterval: fields.recurrenceInterval.default(1),
    openingCents: fields.openingCents.default(0),
    /** Needed for anything with a schedule. Without one it is not used and may be left out. */
    firstDueDate: fields.firstDueDate.optional(),
    endDate: fields.endDate.default(null),
    categoryId: fields.categoryId.default(null),
  })
  .refine((item) => item.recurrenceUnit === "none" || item.firstDueDate !== undefined, {
    path: ["firstDueDate"],
    message: FIRST_DUE_NEEDED_MESSAGE,
  })
  .refine((item) => item.recurrenceUnit === "none" || item.defaultAmountCents > 0, {
    path: ["defaultAmountCents"],
    message: AMOUNT_NEEDED_MESSAGE,
  })
  .refine((item) => item.endDate === null || item.firstDueDate === undefined || item.endDate >= item.firstDueDate, {
    path: ["endDate"],
    message: END_BEFORE_START_MESSAGE,
  })
  .refine((item) => item.kind === "transfer" || item.openingCents === 0, {
    path: ["openingCents"],
    message: OPENING_ONLY_FOR_TRANSFER_MESSAGE,
  });
export type BillOrIncomeInput = z.output<typeof billOrIncomeInputSchema>;

/** Any subset of the fields. The end date is checked against the first due date after merging. */
export const billOrIncomePatchSchema = z
  .object({
    name: fields.name.optional(),
    description: fields.description.optional(),
    kind: fields.kind.optional(),
    openingCents: fields.openingCents.optional(),
    defaultAmountCents: fields.defaultAmountCents.optional(),
    recurrenceUnit: fields.recurrenceUnit.optional(),
    recurrenceInterval: fields.recurrenceInterval.optional(),
    firstDueDate: fields.firstDueDate.optional(),
    endDate: fields.endDate.optional(),
    /** Null takes its category away. Entries it adds from then on follow; existing ones do not. */
    categoryId: fields.categoryId.optional(),
    /**
     * Also file every transaction already tied to it under its category (or under none),
     * replacing whatever category each had.
     */
    applyToTransactions: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");
export type BillOrIncomePatch = z.output<typeof billOrIncomePatchSchema>;

export const endBillOrIncomeSchema = z.object({
  /** Also delete its upcoming transactions dated after today. */
  removeUpcoming: z.boolean(),
});

export type BillOrIncome = {
  id: string;
  name: string;
  description: string;
  kind: BillOrIncomeKind;
  /** A transfer's starting balance, signed; 0 for anything else. */
  openingCents: number;
  /** 0 when the item has no schedule and no usual amount. */
  defaultAmountCents: number;
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  /** For an item with no schedule this is only the day it was added. */
  firstDueDate: LocalDate;
  endDate: LocalDate | null;
  /** The category its entries are filed under as they are added, or null. */
  categoryId: string | null;
  /** Its end date has passed; it produces nothing further. */
  archived: boolean;
  /** Next occurrence from today on, when it can be known ahead of time. */
  nextDueDate: LocalDate | null;
  /** The schedule in words, e.g. "Every month on the 25th". */
  scheduleText: string;
};

export type BillsIncomeListResponse = { items: BillOrIncome[] };
export type BillOrIncomeResponse = {
  item: BillOrIncome;
  /** With `applyToTransactions`: how many transactions were filed differently as a result. */
  refiledTransactions?: number;
};

/** What creating an item would add to the periods that already exist. */
export type BillOrIncomePreview = {
  transactions: number;
  periods: number;
  /** How many of those periods ended before today. */
  pastPeriods: number;
  earliestDate: LocalDate | null;
};

/** The most of an item's transactions one request returns. */
export const MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE = 100;

export const billOrIncomeTransactionsQuerySchema = z.object({
  limit: z.coerce
    .number("Enter a number")
    .int("Enter a whole number")
    .min(1, "Ask for at least one")
    .max(MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE, `Ask for ${MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE} or fewer at a time`)
    .default(30),
  /** `nextCursor` from the page before. Left out for the newest. */
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}_[\w-]{1,100}$/, "That isn't a cursor from an earlier page")
    .optional(),
});
export type BillOrIncomeTransactionsQuery = z.output<typeof billOrIncomeTransactionsQuerySchema>;

/** One page of everything tied to a bill or income, newest first. */
export type BillOrIncomeTransactionsResponse = {
  transactions: Transaction[];
  /** Pass as `before` for the next, older page. Null when this page reaches the oldest. */
  nextCursor: string | null;
  /** Over all of the item's transactions, not only this page. */
  totals: BillOrIncomeTotals;
};

export type BillOrIncomeTotals = {
  count: number;
  /** Signed nets: money out counts against money in. */
  paidCents: number;
  upcomingCents: number;
  /** The paid ones by direction, each as a positive amount. */
  paidOutCents: number;
  paidInCents: number;
  /**
   * For a transfer, what the other account holds as far as the budget knows: its starting
   * balance, plus what was paid out to it, less what was paid back in. Negative is money
   * owed. Null for a bill or an income.
   */
  balanceCents: number | null;
};
