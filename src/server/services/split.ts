import { randomUUID } from "node:crypto";
import {
  addDays,
  addYearsClamped,
  atStartOfDay,
  dateOf,
  formatLongDate,
  type LocalDate,
  type LocalDateTime,
} from "../../shared/dates.ts";
import { formatCents } from "../../shared/money.ts";
import { nominalPeriod, seqForDate } from "../../shared/schedule.ts";
import {
  type AddWaitingResponse,
  fitShares,
  MAX_SPLIT_ITEMS,
  MAX_SPLIT_LABEL,
  MAX_SPLIT_YEARS,
  planSplit,
  type SplitAddInput,
  type SplitChangeResponse,
  type SplitPayment,
  type SplitShare,
  type SplitSkipInput,
  type SplitSummary,
  SPLIT_ROUND_CENTS,
  splitNote,
  type TransactionSplitInput,
  type TransactionSplitResponse,
  type WaitingSplit,
  type WaitingSplitsResponse,
  waitingStatus,
} from "../../shared/split.ts";
import { type ImportRow, MAX_TRANSACTION_CENTS } from "../../shared/transactions.ts";
import { AppError } from "../lib/errors.ts";
import type {
  DataStore,
  PeriodRecord,
  Repos,
  SplitItemRecord,
  SplitRecord,
  SplitWaitingRecord,
  StoredShare,
  TransactionRecord,
} from "../repos/types.ts";
import { createLinkPlanner } from "./billIncomeLinks.ts";
import { applyLeftoverDelta } from "./carry.ts";
import type { ImportService } from "./import.ts";
import type { PeriodService } from "./periods.ts";

export type SplitService = ReturnType<typeof createSplitService>;

/** Carries a dry run's result out of its transaction, which rolls back because this was thrown. */
class DryRunRollback<T> extends Error {
  constructor(readonly result: T) {
    super("Dry run: nothing saved");
  }
}

const NOTE_LIMIT = 500;

const noSuchSplit = () => new AppError(404, "not_found", "Nothing of that split is waiting");
const noSuchKeptSplit = () => new AppError(404, "not_found", "No such split");
const notEditable = () =>
  new AppError(409, "conflict", "This split was made before splits could be changed, so it can't be added to or skipped");

/** One split's waiting payments, as the client sees them, given the last day a period may cover. */
function toWaitingSplit(records: SplitWaitingRecord[], reachEnd: LocalDate): WaitingSplit {
  const { inReach, remind } = waitingStatus(records.map((record) => dateOf(record.occursAt)), reachEnd);
  return {
    id: records[0]!.splitId,
    name: records[0]!.name,
    totalCents: records.reduce((sum, record) => sum + record.amountCents, 0),
    payments: records.map(({ id, occursAt, amountCents, note }) => ({
      id,
      occursAt,
      amountCents,
      note,
      inReach: dateOf(occursAt) <= reachEnd,
    })),
    inReach,
    remind,
  };
}

/** Records grouped by a key, each group in the order the records came. */
function groupBy<T>(records: readonly T[], key: (record: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const group = groups.get(key(record));
    if (group) group.push(record);
    else groups.set(key(record), [record]);
  }
  return groups;
}

/**
 * The pay periods a split can reach, by number: the ones that exist, and past the last of
 * them, the ones still to come, as generation will make them (on from the last one's
 * possibly hand-moved end, to the schedule's nominal dates).
 */
type Calendar = {
  first: PeriodRecord;
  last: PeriodRecord;
  periodAt(seq: number): { startDate: LocalDate; endDate: LocalDate };
  /** The period a date falls in; null before the earliest one. */
  seqOf(date: LocalDate): number | null;
};

/** What to work out again, and from where. */
type Rework = {
  split: SplitRecord;
  items: SplitItemRecord[];
  /** Unpaid payments from this period on are worked out again; earlier ones stay as they are. */
  fromSeq: number;
  /** When a payment is made in `fromSeq`'s own period, its date and time; otherwise a period's payment is on its first day. */
  firstAt?: LocalDateTime;
  /** What to refuse with when an item has something left and no open period to pay it in. */
  stranded: (index: number, leftCents: number) => Error;
};

export function createSplitService(deps: { store: DataStore; periods: PeriodService; imports: ImportService; now?: () => Date }) {
  const { store, periods, imports, now = () => new Date() } = deps;

  function invalid(fields: Record<string, string>): never {
    throw new AppError(400, "validation", Object.values(fields)[0]!, fields);
  }

  /** Runs `fn` in one transaction, which a dry run rolls back once it has its result. */
  async function inTransaction<T>(dryRun: boolean | undefined, fn: (repos: Repos) => Promise<T>): Promise<T> {
    try {
      return await store.transaction(async (repos) => {
        const result = await fn(repos);
        if (dryRun) throw new DryRunRollback(result);
        return result;
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result as T;
      throw error;
    }
  }

  /** Makes the periods from `from` to `to` that may exist (up to a year ahead), and numbers the rest. */
  async function calendarFor(repos: Repos, userId: string, from: LocalDate, to: LocalDate): Promise<Calendar> {
    await periods.extendToward(repos, userId, { from, to: to < from ? from : to }, { addEarlier: false });
    const all = await repos.periods.listAll(userId);
    const schedule = (await repos.schedules.getForUser(userId))!;
    const first = all[0]!;
    const last = all.at(-1)!;
    return {
      first,
      last,
      periodAt(seq) {
        if (seq <= last.seq) {
          const { startDate, endDate } = all[seq - first.seq]!;
          return { startDate, endDate };
        }
        const nominal = nominalPeriod(schedule, seq);
        return { startDate: seq === last.seq + 1 ? addDays(last.endDate, 1) : nominal.start, endDate: nominal.end };
      },
      seqOf(date) {
        if (date > last.endDate) return Math.max(seqForDate(schedule, date), last.seq + 1);
        return all.find((period) => period.startDate <= date && date <= period.endDate)?.seq ?? null;
      },
    };
  }

  /** Refuses due dates before the first payment, or too long after it. */
  function checkDueDates(items: ReadonlyArray<{ dueDate: LocalDate }>, firstDate: LocalDate) {
    const early: Record<string, string> = {};
    for (const [index, item] of items.entries()) {
      if (item.dueDate < firstDate) early[`items.${index}.dueDate`] = "That's before the first payment";
    }
    if (Object.keys(early).length > 0) invalid(early);

    const tooFar = addYearsClamped(firstDate, MAX_SPLIT_YEARS);
    const distant: Record<string, string> = {};
    for (const [index, item] of items.entries()) {
      if (item.dueDate > tooFar) distant[`items.${index}.dueDate`] = `Keep it within ${MAX_SPLIT_YEARS} years of the first payment`;
    }
    if (Object.keys(distant).length > 0) invalid(distant);
  }

  /** The period of a first payment, refused when it is before the earliest one or more than a year ahead. */
  function firstSeqOf(calendar: Calendar, firstDate: LocalDate): number {
    const seq = calendar.seqOf(firstDate);
    if (seq === null || seq > calendar.last.seq) {
      invalid({
        occursAt: firstDate < calendar.first.startDate ? "That's before your earliest pay period" : "That's more than a year ahead",
      });
    }
    return seq;
  }

  /** Refuses finishing early an item due in its first payment's own period. */
  function checkFinishEarly(calendar: Calendar, items: ReadonlyArray<{ dueDate: LocalDate }>, fromSeq: number, finishEarly: boolean) {
    if (!finishEarly) return;
    const problems: Record<string, string> = {};
    for (const [index, item] of items.entries()) {
      if (calendar.seqOf(item.dueDate)! - 1 < fromSeq) {
        problems[`items.${index}.dueDate`] = "That's due in the first payment's period, so it can't finish a period earlier";
      }
    }
    if (Object.keys(problems).length > 0) invalid(problems);
  }

  /**
   * Works out the split's unpaid payments from `fromSeq` on, and makes them so: what is
   * left of each item (its amount less its share of the payments kept: paid ones, and any
   * in earlier periods) spread over the open periods to its due date, rounded up when the
   * split says so. A period whose payment was skipped, or that holds a kept one, is not
   * open. Existing payments are changed in place, new ones made through the import, and
   * ones no longer needed deleted; what falls past the furthest period waits.
   */
  async function rework(
    repos: Repos,
    userId: string,
    calendar: Calendar,
    { split, items, fromSeq, firstAt, stranded }: Rework,
  ): Promise<Pick<TransactionSplitResponse, "payments" | "later" | "current">> {
    const seqAt = (occursAt: LocalDateTime) => calendar.seqOf(dateOf(occursAt)) ?? calendar.first.seq;
    const transactions = await repos.transactions.listForSplit(userId, split.id);
    const waiting = await repos.splitWaiting.listSplit(userId, split.id);
    const keeps = (occursAt: LocalDateTime) => seqAt(occursAt) < fromSeq;
    const kept = transactions.filter((record) => record.status === "paid" || keeps(record.occursAt));
    const open = transactions.filter((record) => !kept.includes(record));
    const keptWaiting = waiting.filter((record) => keeps(record.occursAt));
    const openWaiting = waiting.filter((record) => !keptWaiting.includes(record));

    const position = new Map(items.map((item, index) => [item.id, index]));
    const lastSeqs = items.map((item) => calendar.seqOf(item.dueDate)! - (split.finishEarly ? 1 : 0));
    const soonestFirst = items.map((_, index) => index).sort((a, b) => lastSeqs[a]! - lastSeqs[b]! || a - b);
    const sharesOf = (stored: StoredShare[] | null): SplitShare[] =>
      (stored ?? []).flatMap(({ itemId, cents }) => {
        const item = position.get(itemId);
        return item === undefined ? [] : [{ item, cents }];
      });

    // What each item has left once the kept payments are counted, oldest first. One whose
    // amount was changed by hand counts for what it came to.
    const left = items.map((item) => item.amountCents);
    const keptPayments = [...kept, ...keptWaiting].sort((a, b) => (a.occursAt < b.occursAt ? -1 : a.occursAt > b.occursAt ? 1 : 0));
    for (const payment of keptPayments) {
      const stored = "splitShares" in payment ? payment.splitShares : payment.shares;
      for (const { item, cents } of fitShares(Math.abs(payment.amountCents), sharesOf(stored), soonestFirst, left)) {
        left[item]! -= cents;
      }
    }

    const { payments: plan, stranded: unplaced } = planSplit({
      items: items.map((item, index) => ({
        leftCents: left[index]!,
        firstSeq: calendar.seqOf(item.startDate) ?? calendar.first.seq,
        lastSeq: lastSeqs[index]!,
      })),
      fromSeq,
      closed: new Set([...split.skippedSeqs, ...kept.map((record) => seqAt(record.occursAt))]),
      roundToCents: split.roundUp ? SPLIT_ROUND_CENTS : null,
    });
    if (unplaced.length > 0) throw stranded(unplaced[0]!, left[unplaced[0]!]!);

    const labels = items.map((item) => item.label);
    const sign = split.kind === "expense" ? -1 : 1;
    const planned = plan.map(({ seq, shares }) => ({
      seq,
      shares,
      period: calendar.periodAt(seq),
      cents: shares.reduce((sum, share) => sum + share.cents, 0),
      note: splitNote(split.note ?? undefined, shares, labels),
      reachable: seq <= calendar.last.seq,
    }));
    if (planned.some((payment) => payment.reachable && payment.cents > MAX_TRANSACTION_CENTS)) {
      throw new AppError(
        400,
        "validation",
        `Together these come to more than ${formatCents(MAX_TRANSACTION_CENTS)} in one pay period. Split them separately.`,
      );
    }
    if (planned.some((payment) => payment.note.length > NOTE_LIMIT)) {
      invalid({ note: "With what each item makes up of every payment, the note gets too long. Shorten it or the item names." });
    }
    const stored = (shares: SplitShare[]): StoredShare[] => shares.map(({ item, cents }) => ({ itemId: items[item]!.id, cents }));

    // A period's existing unpaid payment is changed to the new amount, keeping its date and place.
    const changedAt = now();
    const unused = groupBy(open, (record) => String(seqAt(record.occursAt)));
    const made: Array<(typeof planned)[number] & { occursAt: LocalDateTime }> = [];
    const fresh: typeof made = [];
    for (const payment of planned.filter((entry) => entry.reachable)) {
      const existing: TransactionRecord | undefined = unused.get(String(payment.seq))?.shift();
      if (existing) {
        const amountCents = sign * payment.cents;
        const splitShares = stored(payment.shares);
        const note = payment.note || null;
        if (
          amountCents !== existing.amountCents ||
          note !== existing.note ||
          JSON.stringify(splitShares) !== JSON.stringify(existing.splitShares)
        ) {
          await repos.transactions.update(userId, existing.id, { amountCents, note, splitShares }, changedAt);
          await applyLeftoverDelta(repos, userId, payment.seq, amountCents - existing.amountCents, changedAt);
        }
        made.push({ ...payment, occursAt: existing.occursAt });
      } else {
        const occursAt = payment.seq === fromSeq && firstAt ? firstAt : atStartOfDay(payment.period.startDate);
        fresh.push({ ...payment, occursAt });
        made.push({ ...payment, occursAt });
      }
    }
    for (const record of [...unused.values()].flat()) {
      await repos.transactions.delete(userId, record.id);
      await applyLeftoverDelta(repos, userId, seqAt(record.occursAt), -record.amountCents, changedAt);
    }

    let current: TransactionSplitResponse["current"] = null;
    if (fresh.length > 0) {
      const rows: ImportRow[] = fresh.map((payment) => ({
        name: split.name,
        amountCents: payment.cents,
        kind: split.kind,
        occursAt: payment.occursAt,
        note: payment.note,
        billIncomeId: split.billIncomeId,
        categoryId: split.categoryId,
      }));
      try {
        const imported = await imports.importIn(
          repos,
          userId,
          { transactions: rows },
          { split: { id: split.id, shares: (index) => stored(fresh[index]!.shares) } },
        );
        current = imported.current && {
          periodId: imported.current.periodId,
          projectedBeforeCents: imported.current.projectedBeforeCents,
          projectedAfterCents: imported.current.projectedAfterCents,
        };
      } catch (error) {
        // The import names each row's field ("transactions.3.categoryId"); every row carries
        // the same link, so the split's own field is what to point at.
        if (error instanceof AppError && error.fields) {
          const fields: Record<string, string> = {};
          for (const [path, message] of Object.entries(error.fields)) fields[path.replace(/^transactions\.\d+\./, "")] = message;
          invalid(fields);
        }
        throw error;
      }
    }

    // What can't be added yet waits, exactly as worked out, filed where the transactions are.
    const later = planned.filter((payment) => !payment.reachable).map((payment) => ({ ...payment, occursAt: atStartOfDay(payment.period.startDate) }));
    await repos.splitWaiting.deleteMany(userId, openWaiting.map((record) => record.id));
    await repos.splitWaiting.createMany(
      later.map((payment) => ({
        id: randomUUID(),
        userId,
        splitId: split.id,
        name: split.name,
        amountCents: sign * payment.cents,
        occursAt: payment.occursAt,
        note: payment.note || null,
        billIncomeId: split.billIncomeId,
        categoryId: split.categoryId,
        shares: stored(payment.shares),
        createdAt: changedAt,
      })),
    );

    const toPayment = ({ occursAt, cents, period, shares }: (typeof made)[number]): SplitPayment => ({
      occursAt,
      amountCents: sign * cents,
      period,
      shares,
    });
    return { payments: made.map(toPayment), later: later.map(toPayment), current };
  }

  async function create(repos: Repos, userId: string, input: TransactionSplitInput): Promise<TransactionSplitResponse> {
    const firstDate = dateOf(input.occursAt);
    checkDueDates(input.items, firstDate);
    const lastDue = input.items.map((item) => item.dueDate).sort().at(-1)!;
    const calendar = await calendarFor(repos, userId, firstDate, lastDue);
    const startSeq = firstSeqOf(calendar, firstDate);
    checkFinishEarly(calendar, input.items, startSeq, input.finishEarly ?? false);

    // Left out, the category is the bill or income's own, as for a typed-in transaction.
    const link = await createLinkPlanner(repos, userId).plan({
      billIncomeId: input.billIncomeId,
      amountCents: 0,
      categoryId: input.categoryId,
    });
    if ("problems" in link) invalid(link.problems as Record<string, string>);

    const createdAt = now();
    const split: SplitRecord = {
      id: randomUUID(),
      userId,
      name: input.name,
      kind: input.kind,
      note: input.note?.trim() || null,
      billIncomeId: link.billIncomeId,
      categoryId: link.categoryId,
      finishEarly: input.finishEarly ?? false,
      roundUp: input.roundUp ?? false,
      skippedSeqs: [],
      createdAt,
      updatedAt: createdAt,
    };
    const items: SplitItemRecord[] = input.items.map((item, position) => ({
      id: randomUUID(),
      userId,
      splitId: split.id,
      position,
      label: item.label,
      amountCents: item.amountCents,
      dueDate: item.dueDate,
      startDate: firstDate,
      createdAt,
    }));
    await repos.splits.create(split);
    await repos.splits.createItems(items);

    const result = await rework(repos, userId, calendar, {
      split,
      items,
      fromSeq: startSeq,
      firstAt: input.occursAt,
      // Every item is due in or after the first payment's period, which is open.
      stranded: () => new Error("A new split has a period for every item"),
    });
    return {
      dryRun: input.dryRun ?? false,
      ...result,
      waitingId: result.later.length > 0 ? split.id : null,
      splitId: split.id,
    };
  }

  /** A kept split of the user's that can be changed, with its items. */
  async function editable(repos: Repos, userId: string, splitId: string) {
    const split = await repos.splits.findById(userId, splitId);
    if (!split) throw noSuchKeptSplit();
    const items = await repos.splits.listItems(userId, splitId);
    if (items.length === 0) throw notEditable();
    return { split, items };
  }

  const nameOf = (split: SplitRecord, item: SplitItemRecord) => item.label || split.name;

  return {
    /**
     * Spreads each item evenly over the pay periods up to its due date and saves one
     * transaction per period, all or none, keeping the split they belong to. With `dryRun`
     * the same work is done and undone, so the plan returned is exactly what a real run would save.
     */
    async split(userId: string, input: TransactionSplitInput): Promise<TransactionSplitResponse> {
      return inTransaction(input.dryRun, (repos) => create(repos, userId, input));
    },

    /**
     * Adds more to a split, such as another purchase on the same plan: each new item is
     * spread from the period `occursAt` falls in to its due date, and the split's unpaid
     * payments from that period on are worked out again with it.
     */
    async add(userId: string, splitId: string, input: SplitAddInput): Promise<SplitChangeResponse> {
      return inTransaction(input.dryRun, async (repos) => {
        const { split, items } = await editable(repos, userId, splitId);
        if (items.length + input.items.length > MAX_SPLIT_ITEMS) {
          invalid({ items: `A split holds up to ${MAX_SPLIT_ITEMS} things; this one has ${items.length}` });
        }
        const firstDate = dateOf(input.occursAt);
        checkDueDates(input.items, firstDate);
        const lastDue = [...items, ...input.items].map((item) => item.dueDate).sort().at(-1)!;
        const calendar = await calendarFor(repos, userId, firstDate, lastDue);
        const fromSeq = firstSeqOf(calendar, firstDate);
        checkFinishEarly(calendar, input.items, fromSeq, split.finishEarly);

        const changedAt = now();
        // An only item has no name of its own; joined by others, the note needs one for it.
        if (items.length === 1 && items[0]!.label === "") {
          const label = split.name.slice(0, MAX_SPLIT_LABEL).trim();
          await repos.splits.renameItem(userId, items[0]!.id, label);
          items[0] = { ...items[0]!, label };
        }
        const added: SplitItemRecord[] = input.items.map((item, index) => ({
          id: randomUUID(),
          userId,
          splitId,
          position: items.length + index,
          label: item.label,
          amountCents: item.amountCents,
          dueDate: item.dueDate,
          startDate: firstDate,
          createdAt: changedAt,
        }));
        await repos.splits.createItems(added);
        const changed = { ...split, roundUp: input.roundUp ?? split.roundUp };
        if (changed.roundUp !== split.roundUp) await repos.splits.update(userId, splitId, { roundUp: changed.roundUp }, changedAt);

        const all = [...items, ...added];
        const result = await rework(repos, userId, calendar, {
          split: changed,
          items: all,
          fromSeq,
          firstAt: input.occursAt,
          stranded: (index, leftCents) =>
            index >= items.length
              ? invalid({ [`items.${index - items.length}.dueDate`]: "Every pay period before then is already paid or skipped" })
              : new AppError(
                  409,
                  "conflict",
                  `${formatCents(leftCents)} of ${nameOf(split, all[index]!)} isn't covered by its payments before ${formatLongDate(all[index]!.dueDate)}. Add a payment for it first.`,
                ),
        });
        return { dryRun: input.dryRun ?? false, payments: result.payments, later: result.later, labels: all.length > 1 ? all.map((item) => item.label) : [] };
      });
    },

    /**
     * Leaves one unpaid payment of a split out: it is deleted, its pay period is skipped
     * from then on, and what it held is spread over the split's payments after it. Refused
     * when it is the last chance to pay an item before its due date.
     */
    async skip(userId: string, splitId: string, input: SplitSkipInput): Promise<SplitChangeResponse> {
      return inTransaction(input.dryRun, async (repos) => {
        const { split, items } = await editable(repos, userId, splitId);
        const payment = await repos.transactions.findById(userId, input.transactionId);
        if (!payment || payment.splitId !== splitId) throw new AppError(404, "not_found", "No such payment of this split");
        if (payment.status === "paid") throw new AppError(409, "conflict", "That payment is already paid");

        const date = dateOf(payment.occursAt);
        const lastDue = items.map((item) => item.dueDate).sort().at(-1)!;
        const calendar = await calendarFor(repos, userId, date, lastDue);
        const seq = calendar.seqOf(date)!;
        const changedAt = now();
        const changed = { ...split, skippedSeqs: [...new Set([...split.skippedSeqs, seq])].sort((a, b) => a - b) };
        await repos.splits.update(userId, splitId, { skippedSeqs: changed.skippedSeqs }, changedAt);
        await repos.transactions.delete(userId, payment.id);
        await applyLeftoverDelta(repos, userId, seq, -payment.amountCents, changedAt);

        const result = await rework(repos, userId, calendar, {
          split: changed,
          items,
          fromSeq: seq + 1,
          stranded: (index) =>
            new AppError(
              409,
              "conflict",
              `That's the last payment before ${nameOf(split, items[index]!)} is due on ${formatLongDate(items[index]!.dueDate)}, so it can't be skipped`,
            ),
        });
        return {
          dryRun: input.dryRun ?? false,
          payments: result.payments,
          later: result.later,
          labels: items.length > 1 ? items.map((item) => item.label) : [],
          skipped: { occursAt: payment.occursAt, amountCents: payment.amountCents },
        };
      });
    },

    /**
     * Every split with something still to pay, oldest first: its unpaid payments, what
     * waits (with whether that is worth a reminder) and what is left of each item.
     */
    async waiting(userId: string): Promise<WaitingSplitsResponse> {
      return store.transaction(async (repos) => {
        const reachEnd = await periods.reachEnd(repos, userId);
        const itemsOf = groupBy(await repos.splits.listItemsForUser(userId), (item) => item.splitId);
        const paymentsOf = groupBy(await repos.transactions.listInSplits(userId), (record) => record.splitId!);
        const waitingOf = groupBy(await repos.splitWaiting.listForUser(userId), (record) => record.splitId);

        const splits: SplitSummary[] = [];
        for (const split of await repos.splits.listForUser(userId)) {
          const payments = paymentsOf.get(split.id) ?? [];
          const upcoming = payments.filter((record) => record.status === "upcoming");
          const waiting = waitingOf.get(split.id) ?? [];
          if (upcoming.length === 0 && waiting.length === 0) continue;

          const leftOf = new Map<string, number>();
          for (const { itemId, cents } of [...upcoming.flatMap((record) => record.splitShares ?? []), ...waiting.flatMap((record) => record.shares ?? [])]) {
            leftOf.set(itemId, (leftOf.get(itemId) ?? 0) + cents);
          }
          const items = itemsOf.get(split.id) ?? [];
          splits.push({
            ...(waiting.length > 0
              ? toWaitingSplit(waiting, reachEnd)
              : { id: split.id, totalCents: 0, payments: [], inReach: 0, remind: false }),
            name: split.name,
            kind: split.kind,
            editable: items.length > 0,
            roundUp: split.roundUp,
            finishEarly: split.finishEarly,
            items: items.map(({ id, label, amountCents, dueDate }) => ({ id, label, amountCents, dueDate, leftCents: leftOf.get(id) ?? 0 })),
            upcoming: upcoming.map(({ id, occursAt, amountCents, note }) => ({ id, occursAt, amountCents, note })),
            paidCents: Math.abs(payments.filter((record) => record.status === "paid").reduce((sum, record) => sum + record.amountCents, 0)),
          });
        }
        return { splits };
      });
    },

    /**
     * Adds the split's waiting payments whose pay periods may exist now, as the transactions
     * they were worked out to be, and stops them waiting. 409 if none can be added yet.
     */
    async addWaiting(userId: string, splitId: string): Promise<AddWaitingResponse> {
      return store.transaction(async (repos) => {
        const records = await repos.splitWaiting.listSplit(userId, splitId);
        if (records.length === 0) throw noSuchSplit();
        await periods.extendToward(
          repos,
          userId,
          { from: dateOf(records[0]!.occursAt), to: dateOf(records.at(-1)!.occursAt) },
          { addEarlier: false },
        );
        const lastEnd = (await repos.periods.findLast(userId))!.endDate;
        const ready = records.filter((record) => dateOf(record.occursAt) <= lastEnd);
        if (ready.length === 0) throw new AppError(409, "conflict", "None of these can be added yet: their pay periods are more than a year ahead");

        await imports.importIn(
          repos,
          userId,
          {
            transactions: ready.map((record) => ({
              name: record.name,
              amountCents: Math.abs(record.amountCents),
              kind: record.amountCents < 0 ? "expense" : "income",
              occursAt: record.occursAt,
              note: record.note ?? undefined,
              billIncomeId: record.billIncomeId,
              categoryId: record.categoryId,
            })),
          },
          { split: { id: splitId, shares: (index) => ready[index]!.shares } },
        );
        await repos.splitWaiting.deleteMany(userId, ready.map((record) => record.id));

        const rest = records.filter((record) => !ready.includes(record));
        return {
          added: ready.map(({ occursAt, amountCents }) => ({ occursAt, amountCents })),
          ...(rest.length > 0 && { waiting: toWaitingSplit(rest, await periods.reachEnd(repos, userId)) }),
        };
      });
    },

    /** Stops waiting: the split's payments not yet added are dropped. Those already added stay. */
    async cancelWaiting(userId: string, splitId: string): Promise<void> {
      await store.transaction(async (repos) => {
        const records = await repos.splitWaiting.listSplit(userId, splitId);
        if (records.length === 0) throw noSuchSplit();
        await repos.splitWaiting.deleteMany(userId, records.map((record) => record.id));
      });
    },
  };
}
