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

const idSchema = z.string().min(1).max(100);

export const transactionInputSchema = z.object({
  name: nameSchema,
  /** Always positive; `kind` says which way the money moves. */
  amountCents: amountSchema,
  kind: kindSchema,
  occursAt: occursAtSchema,
  note: noteSchema.optional(),
  /** Create it already marked as paid. */
  paid: z.boolean().optional(),
  /** The bill or income this belongs to, if any. */
  billIncomeId: idSchema.nullable().optional(),
  /**
   * An upcoming transaction a bill or income added, which this one pays part or all of.
   * That entry shrinks by this amount and is removed once nothing is left of it. It also
   * ties this transaction to the same item.
   */
  countsToward: idSchema.optional(),
  /** The category to file it under, if any. */
  categoryId: idSchema.nullable().optional(),
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
    /** Ties it to a bill or income; null unties it. */
    billIncomeId: idSchema.nullable().optional(),
    /** Files it under a category; null files it under none. */
    categoryId: idSchema.nullable().optional(),
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
  /** The bill or income it belongs to: the one that generated it, or one it was tied to. Null for neither. */
  billIncomeId: string | null;
  /**
   * The scheduled date it was generated for. Set only on a transaction a bill or income
   * added by itself, so it tells those apart from ones tied to the item afterwards.
   */
  occurrenceDate: LocalDate | null;
  /** The key it was imported under, or null if it was entered or generated in the app. */
  importKey: string | null;
  /** The category it is filed under, or null. */
  categoryId: string | null;
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

/** The most search results one request returns. */
export const MAX_SEARCH_PAGE = 100;
/** In a search's `categoryId`: only transactions filed under no category. */
export const NO_CATEGORY = "none";
export const NOTHING_TO_SEARCH_MESSAGE = "Enter something to search for, or choose a category or dates";

/**
 * Finds transactions across every pay period. `q` matches any part of the name or the
 * note, whatever its capitals. Everything given must match; at least one thing must be given.
 */
export const transactionSearchSchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(100, "Keep the search under 100 characters")
      .optional()
      .transform((text) => text || undefined),
    /** The first and last day to look in, both included. Either may be left out. */
    from: rangeDateSchema.optional(),
    to: rangeDateSchema.optional(),
    /** A category's id, or NO_CATEGORY for transactions filed under nothing. */
    categoryId: z.string().min(1).max(100).optional(),
    limit: z.coerce
      .number("Enter a number")
      .int("Enter a whole number")
      .min(1, "Ask for at least one")
      .max(MAX_SEARCH_PAGE, `Ask for ${MAX_SEARCH_PAGE} or fewer at a time`)
      .default(50),
    /** `nextCursor` from the page before. Left out for the newest. */
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}_[\w-]{1,100}$/, "That isn't a cursor from an earlier page")
      .optional(),
  })
  .refine(({ q, from, to, categoryId }) => [q, from, to, categoryId].some((value) => value !== undefined), {
    path: ["q"],
    message: NOTHING_TO_SEARCH_MESSAGE,
  })
  .refine(({ from, to }) => from === undefined || to === undefined || to >= from, {
    path: ["to"],
    message: "The end date is before the start date",
  });
export type TransactionSearchQuery = z.output<typeof transactionSearchSchema>;

/** One page of what a search found, newest first. */
export type TransactionSearchResponse = {
  transactions: Transaction[];
  /** Pass as `before` for the next, older page. Null when this page reaches the oldest. */
  nextCursor: string | null;
  /** Over everything the search found, not only this page. Each a positive amount. */
  totals: { count: number; outCents: number; inCents: number };
};

/** What became of an upcoming entry that a payment counted toward. */
export type CountedToward = {
  id: string;
  name: string;
  /** What was due before this request, signed like the entry itself. */
  previousCents: number;
  /** What is still due, signed like the entry itself. 0 when it was paid off. */
  remainingCents: number;
  /** Paid off, and so deleted. It does not come back if the payment is later changed or deleted. */
  removed: boolean;
};

/** Returned by create and update: the saved transaction and the period it now falls in. */
export type TransactionResponse = {
  transaction: Transaction;
  period: { id: string; startDate: LocalDate; endDate: LocalDate };
  /** Present when the transaction was created with `countsToward`. */
  countedToward?: CountedToward;
};

/** The most rows one import request may carry. */
export const MAX_IMPORT_ROWS = 500;
/** How many days either side of a row an existing transaction of the same amount is reported as a possible duplicate. */
export const DUPLICATE_WINDOW_DAYS = 3;

export const importRowSchema = transactionInputSchema.extend({
  /**
   * The importer's own name for this row, such as the bank's transaction id. A row whose
   * key the account already holds, or held until the user deleted that transaction, is
   * skipped, which makes an import safe to repeat.
   */
  importKey: z.string().trim().min(1, "Enter a key or leave it out").max(100, "Keep the key under 100 characters").optional(),
});
export type ImportRow = z.output<typeof importRowSchema>;

export const transactionImportSchema = z
  .object({
    /** Work everything out and report it, but save nothing. */
    dryRun: z.boolean().optional(),
    /** Allow rows dated before the earliest pay period by adding the periods they need. */
    addEarlierPeriods: z.boolean().optional(),
    /** Import rows even if the transaction once imported under the same key was deleted. */
    restoreDeleted: z.boolean().optional(),
    transactions: z
      .array(importRowSchema)
      .min(1, "Nothing to import")
      .max(MAX_IMPORT_ROWS, `Send ${MAX_IMPORT_ROWS} transactions or fewer at a time`),
  })
  .superRefine(({ transactions }, context) => {
    const firstUse = new Map<string, number>();
    for (const [index, row] of transactions.entries()) {
      if (typeof row?.importKey !== "string") continue;
      const earlier = firstUse.get(row.importKey);
      if (earlier === undefined) firstUse.set(row.importKey, index);
      else {
        context.addIssue({
          code: "custom",
          path: ["transactions", index, "importKey"],
          message: `Row ${earlier} of this request has the same key`,
        });
      }
    }
  });
export type TransactionImportInput = z.output<typeof transactionImportSchema>;

/** An incoming row that may be the same payment as a transaction the account already holds. */
export type PossibleDuplicate = {
  /** Position of the incoming row in the request. */
  index: number;
  /** The closest transaction of the same amount within DUPLICATE_WINDOW_DAYS. */
  existing: Transaction;
  /**
   * What the existing one is: an entry a bill or income generated, something entered by
   * hand, or imported under a different key (reported only when the date and name also match).
   */
  reason: "generated" | "manual" | "imported";
  /** Days between the two dates; 0 when they share a date. */
  daysApart: number;
};

/** A guess at which bill or income an incoming row belongs to. Never applied by the server. */
export type BillOrIncomeSuggestion = {
  /** Position of the incoming row in the request. */
  index: number;
  billIncomeId: string;
  billIncomeName: string;
  /**
   * Why: `occurrence`, the row looks like the upcoming entry that item generated (and
   * `countsToward` names it); `same_description`, a transaction already tied to the item
   * has the same note or name; `name`, the item's name appears in the row.
   */
  reason: "occurrence" | "same_description" | "name";
  /** With `occurrence`: the upcoming entry to put in the row's `countsToward`. */
  countsToward?: string;
};

export type TransactionImportResponse = {
  dryRun: boolean;
  /** Rows saved, or that would be on a real run. */
  created: number;
  /**
   * Rows left out because of their key: `held` when a transaction with that key is in the
   * account, `deleted` when there was one and the user deleted it.
   */
  skipped: Array<{ index: number; importKey: string; reason: "held" | "deleted" }>;
  /** Pay periods created to hold the rows. Each brings what its bills and income schedule with it. */
  periodsAdded: { earlier: number; later: number };
  /** The periods that received rows, oldest first. */
  periods: Array<{ id: string; startDate: LocalDate; endDate: LocalDate; count: number; netCents: number }>;
  /** A report only: these rows are imported like any other unless the caller takes them out. */
  possibleDuplicates: PossibleDuplicate[];
  /** Upcoming entries that rows of this request paid toward, and what is left of each. */
  countedToward: CountedToward[];
  /**
   * For rows that say nothing about a bill or income: which one each probably belongs to.
   * A report only. To accept one, put its `billIncomeId` (and `countsToward`) on the row.
   */
  billOrIncomeSuggestions: BillOrIncomeSuggestion[];
  /** Today's period before and after, or null if no period covers today. */
  current: {
    periodId: string;
    leftoverBeforeCents: number;
    leftoverAfterCents: number;
    projectedBeforeCents: number;
    projectedAfterCents: number;
  } | null;
};
