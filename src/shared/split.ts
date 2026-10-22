import { z } from "zod";
import { isLocalDate, type LocalDate, type LocalDateTime } from "./dates.ts";
import { formatCents } from "./money.ts";
import { transactionInputSchema } from "./transactions.ts";

// Splitting: one or more amounts, each due by a date, spread evenly over the pay periods
// from the first payment's to the one each is due in, then saved as one transaction per
// period holding every item's share of it. The split is kept, and its transactions point
// back at it, so it can be added to or have a payment skipped later: either works out
// again what its unpaid payments must be.

/** The most items one split may spread. */
export const MAX_SPLIT_ITEMS = 10;
/** The longest name an item may have; with several, the note lists each by it. */
export const MAX_SPLIT_LABEL = 40;
/** What "Round up" rounds each pay period's payment up to a multiple of: $50. */
export const SPLIT_ROUND_CENTS = 5_000;

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
    /**
     * Round each pay period's payment up to the next multiple of SPLIT_ROUND_CENTS. The
     * extra pays the items due soonest ahead, so the last payments shrink or drop off.
     */
    roundUp: z.boolean().optional(),
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

/**
 * More to pay through a split that exists, such as a second purchase on the same plan. Each
 * new item is spread from the pay period `occursAt` falls in; the split's unpaid payments
 * from that period on are worked out again with them.
 */
export const splitAddSchema = z
  .object({
    dryRun: z.boolean().optional(),
    /** The new items' first payment. */
    occursAt: fields.occursAt,
    /** Changes whether the split rounds up; left out, it stays as it was. */
    roundUp: z.boolean().optional(),
    items: z
      .array(splitItemSchema)
      .min(1, "Add something to split")
      .max(MAX_SPLIT_ITEMS, `Split ${MAX_SPLIT_ITEMS} things or fewer at a time`),
  })
  .superRefine(({ items }, context) => {
    // Joining what is already there, every new one needs a name for the note.
    for (const [index, item] of items.entries()) {
      if (item?.label === "") context.addIssue({ code: "custom", path: ["items", index, "label"], message: "Say what this one is" });
    }
  });
export type SplitAddInput = z.output<typeof splitAddSchema>;

/** Leaves one unpaid payment of a split out; what it held is spread over the payments after it. */
export const splitSkipSchema = z.object({
  dryRun: z.boolean().optional(),
  transactionId: z.string().min(1).max(100),
});
export type SplitSkipInput = z.output<typeof splitSkipSchema>;

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
  /** The split that was made (absent from servers older than phase 31). */
  splitId?: string;
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

/** One item of a split as the planner sees it, by pay period number (seq). */
export type PlanItem = {
  /** What is still to be paid of it, positive. Zero or less: nothing is planned for it. */
  leftCents: number;
  /** The first pay period it may take a share of. */
  firstSeq: number;
  /** The last: the one it is due in, or the one before when finishing early. */
  lastSeq: number;
};

/** One payment the planner made, in pay period `seq`, with every item's share of it (none empty). */
export type PlannedPayment = { seq: number; shares: SplitShare[] };

/**
 * What is left of each item spread evenly over its open pay periods from `fromSeq` on (those
 * in its own span, not in `closed`), a period's payment being the sum of its shares. Items
 * with something left and no open period at all are returned in `stranded`, unplanned.
 *
 * With `roundToCents`, each period's payment is that total rounded up to a multiple of it,
 * and the extra goes to the items due soonest. A payment never goes past what is left, so
 * the items finish early and the last payments shrink or drop off. Every item is still
 * paid by its last period: what has been paid of it by any period is at least what the
 * even split would have paid.
 */
export function planSplit({
  items,
  fromSeq,
  closed = new Set(),
  roundToCents = null,
}: {
  items: readonly PlanItem[];
  fromSeq: number;
  closed?: ReadonlySet<number>;
  roundToCents?: number | null;
}): { payments: PlannedPayment[]; stranded: number[] } {
  const stranded: number[] = [];
  // Each item's even share of each open period it covers.
  const even = items.map(() => new Map<number, number>());
  const seqs = new Set<number>();
  for (const [index, item] of items.entries()) {
    if (item.leftCents <= 0) continue;
    const open: number[] = [];
    for (let seq = Math.max(fromSeq, item.firstSeq); seq <= item.lastSeq; seq++) {
      if (!closed.has(seq)) open.push(seq);
    }
    if (open.length === 0) {
      stranded.push(index);
      continue;
    }
    for (const [at, cents] of splitEvenly(item.leftCents, open.length).entries()) {
      even[index]!.set(open[at]!, cents);
      seqs.add(open[at]!);
    }
  }

  const left = items.map((item, index) => (stranded.includes(index) ? 0 : Math.max(0, item.leftCents)));
  const soonestFirst = items.map((_, index) => index).sort((a, b) => items[a]!.lastSeq - items[b]!.lastSeq || a - b);
  const payments: PlannedPayment[] = [];
  for (const seq of [...seqs].sort((a, b) => a - b)) {
    const planned = items.map((_, index) => even[index]!.get(seq) ?? 0);
    const cents = planned.map((share, index) => Math.min(share, left[index]!));
    if (roundToCents) {
      const total = planned.reduce((sum, share) => sum + share, 0);
      let extra = Math.ceil(total / roundToCents) * roundToCents - cents.reduce((sum, share) => sum + share, 0);
      for (const index of soonestFirst) {
        if (extra <= 0) break;
        if (!even[index]!.has(seq)) continue;
        const more = Math.min(extra, left[index]! - cents[index]!);
        cents[index]! += more;
        extra -= more;
      }
    }
    const shares = cents.flatMap((share, item) => (share > 0 ? [{ item, cents: share }] : []));
    for (const { item, cents: share } of shares) left[item]! -= share;
    if (shares.length > 0) payments.push({ seq, shares });
  }
  return { payments, stranded };
}

/**
 * A payment's shares made to add up to what it really came to, for one whose amount was
 * changed by hand: what it is short comes off the items due last; what it is over goes to
 * the items due soonest (`soonestFirst`), each up to what it had left before this payment
 * (`room`, by item). Anything beyond all of that is simply not counted toward any item.
 */
export function fitShares(
  amountCents: number,
  shares: readonly SplitShare[],
  soonestFirst: readonly number[],
  room: readonly number[],
): SplitShare[] {
  const cents = new Map(shares.map(({ item, cents }) => [item, cents]));
  let gap = amountCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const item of [...soonestFirst].reverse()) {
    if (gap >= 0) break;
    const less = Math.min(-gap, cents.get(item) ?? 0);
    cents.set(item, (cents.get(item) ?? 0) - less);
    gap += less;
  }
  for (const item of soonestFirst) {
    if (gap <= 0) break;
    const more = Math.min(gap, Math.max(0, (room[item] ?? 0) - (cents.get(item) ?? 0)));
    cents.set(item, (cents.get(item) ?? 0) + more);
    gap -= more;
  }
  return [...cents.entries()]
    .filter(([, share]) => share > 0)
    .sort(([a], [b]) => a - b)
    .map(([item, share]) => ({ item, cents: share }));
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

/** One item of a split, as listed. */
export type SplitItemSummary = {
  id: string;
  /** Empty for the only item of a split. */
  label: string;
  /** The whole amount, positive. */
  amountCents: number;
  dueDate: LocalDate;
  /** What has not been paid of it yet, positive: its share of unpaid and waiting payments. */
  leftCents: number;
};

/** An unpaid transaction a split made. */
export type SplitUpcomingPayment = { id: string; occursAt: LocalDateTime; amountCents: number; note: string | null };

/**
 * A split with something still to pay, as GET /api/splits lists it: what waits (the
 * WaitingSplit part) and, from servers of phase 31 on, the rest of it.
 */
export type SplitSummary = WaitingSplit & {
  kind?: "expense" | "income";
  /** It can be added to and have payments skipped. False for a split made before splits were kept. */
  editable?: boolean;
  roundUp?: boolean;
  finishEarly?: boolean;
  /** In the order they were added. Empty for a split that isn't editable. */
  items?: SplitItemSummary[];
  /** Its transactions not yet paid, oldest first. */
  upcoming?: SplitUpcomingPayment[];
  /** What its paid transactions came to, positive. */
  paidCents?: number;
};

export type WaitingSplitsResponse = { splits: SplitSummary[] };

/** What adding to a split, or skipping one of its payments, does (or with `dryRun`, would do). */
export type SplitChangeResponse = {
  dryRun: boolean;
  /** Its unpaid payments from the pay period the change starts in, as they now are; oldest first. */
  payments: SplitPayment[];
  /** Those too far ahead to be added yet, which wait. */
  later: SplitPayment[];
  /** The item names, by position, that `shares` refer to; empty with a single item. */
  labels: string[];
  /** When skipping: the payment left out. */
  skipped?: { occursAt: LocalDateTime; amountCents: number };
};

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
