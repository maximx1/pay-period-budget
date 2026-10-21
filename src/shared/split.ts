import { z } from "zod";
import { isLocalDate, type LocalDate, type LocalDateTime } from "./dates.ts";
import { formatCents } from "./money.ts";
import { transactionInputSchema } from "./transactions.ts";

// Splitting: one or more amounts, each due by a date, spread evenly over the pay periods
// from the first payment's to the one each is due in, then saved as one transaction per
// period holding every item's share of it. A batch way of making ordinary transactions:
// nothing ties them together afterwards unless they are tied to a bill or income.

/** The most items one split may spread. */
export const MAX_SPLIT_ITEMS = 10;
/** The longest name an item may have; with several, the note lists each by it. */
export const MAX_SPLIT_LABEL = 40;

const fields = transactionInputSchema.shape;

export const splitItemSchema = z.object({
  /** What it is, such as "Laptop". Needed only when there are several: the note names each. */
  label: z.string().trim().max(MAX_SPLIT_LABEL, `Keep it under ${MAX_SPLIT_LABEL} characters`),
  /** The whole amount, positive; the split's `kind` says which way it moves. */
  amountCents: fields.amountCents,
  /**
   * The last day it may be paid by. Its last share lands in the period holding this day.
   * Up to MAX_SPLIT_YEARS after the first payment; shares more than a year ahead are
   * worked out but not saved (see `later` in the response).
   */
  dueDate: z.string("Enter a date").refine(isLocalDate, "Enter a valid date"),
});
export type SplitItem = z.output<typeof splitItemSchema>;

export const transactionSplitSchema = z
  .object({
    /** Work out the payments and report them, but save nothing. */
    dryRun: z.boolean().optional(),
    name: fields.name,
    kind: fields.kind,
    /** The first payment. The rest fall at the start of each pay period after its own. */
    occursAt: fields.occursAt,
    /** Goes on every payment, ahead of the list of what each item makes up of it. */
    note: fields.note,
    billIncomeId: fields.billIncomeId,
    categoryId: fields.categoryId,
    /** End each item a period early: in the one before the period its due date falls in. */
    finishEarly: z.boolean().optional(),
    items: z
      .array(splitItemSchema)
      .min(1, "Add something to split")
      .max(MAX_SPLIT_ITEMS, `Split ${MAX_SPLIT_ITEMS} things or fewer at a time`),
  })
  .superRefine(({ items }, context) => {
    if (items.length < 2) return;
    for (const [index, item] of items.entries()) {
      if (item?.label === "") context.addIssue({ code: "custom", path: ["items", index, "label"], message: "Say what this one is" });
    }
  });
export type TransactionSplitInput = z.output<typeof transactionSplitSchema>;

/** One transaction a split makes. */
export type SplitPayment = {
  occursAt: LocalDateTime;
  /** Signed like any transaction: negative for an expense. */
  amountCents: number;
  /** The pay period it falls in. */
  period: { startDate: LocalDate; endDate: LocalDate };
  /** What each item makes up of it, positive, by the item's position in the request. Items with no part in it are left out. */
  shares: SplitShare[];
};
export type SplitShare = { item: number; cents: number };

/** How far after the first payment a due date may be. */
export const MAX_SPLIT_YEARS = 5;

export type TransactionSplitResponse = {
  dryRun: boolean;
  /** The transactions made (or that a real run would make), oldest first. */
  payments: SplitPayment[];
  /**
   * The rest of the split, in pay periods more than a year ahead, which can't exist yet:
   * worked out from the schedule so every share is the true one, and kept as waiting
   * payments to add once their periods are in reach. Oldest first; often empty.
   */
  later: SplitPayment[];
  /** The id `later` waits under (see WaitingSplit), or null when nothing is left to wait. */
  waitingId: string | null;
  /** Today's period before and after, or null if no period covers today. */
  current: { periodId: string; projectedBeforeCents: number; projectedAfterCents: number } | null;
};

/**
 * `totalCents` cut into `parts` whole-cent shares as equal as they can be: they differ by
 * at most a cent, and the earlier ones take the extra cents, so the money is set aside sooner.
 */
export function splitEvenly(totalCents: number, parts: number): number[] {
  const base = Math.floor(totalCents / parts);
  const extra = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Each item spread over its own number of periods, all starting together; returns, for
 * each period in turn, every item's share of it. A share too small to exist (a few cents
 * over many periods) is left out, and so is a period left with none.
 */
export function planShares(items: ReadonlyArray<{ amountCents: number; periods: number }>): SplitShare[][] {
  const length = Math.max(0, ...items.map((item) => item.periods));
  const plan: SplitShare[][] = Array.from({ length }, () => []);
  for (const [item, { amountCents, periods }] of items.entries()) {
    for (const [index, cents] of splitEvenly(amountCents, periods).entries()) {
      if (cents > 0) plan[index]!.push({ item, cents });
    }
  }
  return plan;
}

/** What the payments too far ahead to add yet come to, as a positive amount. */
export function laterTotal({ later }: Pick<TransactionSplitResponse, "later">): number {
  return Math.abs(later.reduce((sum, payment) => sum + payment.amountCents, 0));
}

/**
 * The note a payment carries: the split's own note, then, when several items share the
 * payment, what each makes up of it ("Laptop $43.27 + Couch $20.00").
 */
export function splitNote(note: string | undefined, shares: readonly SplitShare[], labels: readonly string[]): string {
  const breakdown =
    labels.length > 1 ? shares.map(({ item, cents }) => `${labels[item]} ${formatCents(cents)}`).join(" + ") : "";
  return [note?.trim(), breakdown].filter(Boolean).join(" · ");
}

// Waiting payments: what a split left for pay periods too far ahead to exist yet. A
// reminder offers to add them once enough have come within reach to be worth the
// interruption, rather than every payday.

/** How many waiting payments of one split must be in reach before a reminder, short of all of them. */
export const SPLIT_REMIND_AFTER = 3;

export type WaitingPayment = {
  id: string;
  occursAt: LocalDateTime;
  /** Signed like any transaction. */
  amountCents: number;
  note: string | null;
  /** Its pay period may exist now, so it can be added. */
  inReach: boolean;
};

/** What one split still has waiting. */
export type WaitingSplit = {
  /** The split's id, shared by its waiting payments. */
  id: string;
  name: string;
  /** What is still waiting, signed. */
  totalCents: number;
  /** Oldest first. */
  payments: WaitingPayment[];
  /** How many can be added now. */
  inReach: number;
  /** Worth a reminder: everything left can be added, or at least SPLIT_REMIND_AFTER payments can. */
  remind: boolean;
};

export type WaitingSplitsResponse = { splits: WaitingSplit[] };

/** What adding a split's payments that are in reach did. */
export type AddWaitingResponse = {
  /** The transactions made, oldest first. */
  added: Array<{ occursAt: LocalDateTime; amountCents: number }>;
  /** What the split still has waiting; absent once nothing is left. */
  waiting?: WaitingSplit;
};

/**
 * Whether one split's waiting payments call for a reminder, given the last day a pay
 * period may cover (`reachEnd`): once all of them can be added, or SPLIT_REMIND_AFTER can.
 */
export function waitingStatus(dates: readonly LocalDate[], reachEnd: LocalDate): { inReach: number; remind: boolean } {
  const inReach = dates.filter((date) => date <= reachEnd).length;
  return { inReach, remind: inReach > 0 && (inReach === dates.length || inReach >= SPLIT_REMIND_AFTER) };
}
