import { randomUUID } from "node:crypto";
import { addDays, addYearsClamped, atStartOfDay, dateOf, type LocalDate } from "../../shared/dates.ts";
import { formatCents } from "../../shared/money.ts";
import { nominalPeriod, seqForDate } from "../../shared/schedule.ts";
import {
  type AddWaitingResponse,
  MAX_SPLIT_YEARS,
  planShares,
  splitNote,
  type TransactionSplitInput,
  type TransactionSplitResponse,
  type WaitingSplit,
  type WaitingSplitsResponse,
  waitingStatus,
} from "../../shared/split.ts";
import { type ImportRow, MAX_TRANSACTION_CENTS } from "../../shared/transactions.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore, Repos, SplitWaitingRecord } from "../repos/types.ts";
import type { ImportService } from "./import.ts";
import type { PeriodService } from "./periods.ts";

export type SplitService = ReturnType<typeof createSplitService>;

/** Carries a dry run's result out of its transaction, which rolls back because this was thrown. */
class DryRunRollback extends Error {
  constructor(readonly result: TransactionSplitResponse) {
    super("Dry run: nothing saved");
  }
}

const NOTE_LIMIT = 500;

const noSuchSplit = () => new AppError(404, "not_found", "Nothing of that split is waiting");

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

export function createSplitService(deps: { store: DataStore; periods: PeriodService; imports: ImportService; now?: () => Date }) {
  const { store, periods, imports, now = () => new Date() } = deps;

  function invalid(fields: Record<string, string>): never {
    throw new AppError(400, "validation", Object.values(fields)[0]!, fields);
  }

  async function run(repos: Repos, userId: string, input: TransactionSplitInput): Promise<TransactionSplitResponse> {
    const firstDate = dateOf(input.occursAt);
    const early: Record<string, string> = {};
    for (const [index, item] of input.items.entries()) {
      if (item.dueDate < firstDate) early[`items.${index}.dueDate`] = "That's before the first payment";
    }
    if (Object.keys(early).length > 0) invalid(early);

    const tooFar = addYearsClamped(firstDate, MAX_SPLIT_YEARS);
    const distant: Record<string, string> = {};
    for (const [index, item] of input.items.entries()) {
      if (item.dueDate > tooFar) distant[`items.${index}.dueDate`] = `Keep it within ${MAX_SPLIT_YEARS} years of the first payment`;
    }
    if (Object.keys(distant).length > 0) invalid(distant);

    // Make the periods the split reaches, as far as they are allowed to exist: a year ahead.
    const lastDue = input.items.map((item) => item.dueDate).sort().at(-1)!;
    await periods.extendToward(repos, userId, { from: firstDate, to: lastDue }, { addEarlier: false });
    const all = await repos.periods.listAll(userId);
    const schedule = (await repos.schedules.getForUser(userId))!;
    const first = all[0]!;
    const last = all.at(-1)!;

    // Periods by number, so a split can run on past the last one that may exist: those are
    // worked out as they will be generated (on from the last one's end, to the nominal end).
    const periodAt = (seq: number): { startDate: LocalDate; endDate: LocalDate } => {
      if (seq <= last.seq) {
        const { startDate, endDate } = all[seq - first.seq]!;
        return { startDate, endDate };
      }
      const nominal = nominalPeriod(schedule, seq);
      return { startDate: seq === last.seq + 1 ? addDays(last.endDate, 1) : nominal.start, endDate: nominal.end };
    };
    const seqOf = (date: LocalDate): number | null => {
      if (date > last.endDate) return Math.max(seqForDate(schedule, date), last.seq + 1);
      return all.find((period) => period.startDate <= date && date <= period.endDate)?.seq ?? null;
    };

    const startSeq = seqOf(firstDate);
    if (startSeq === null || startSeq > last.seq) {
      invalid({
        occursAt: firstDate < first.startDate ? "That's before your earliest pay period" : "That's more than a year ahead",
      });
    }

    // How many periods each item is spread over: from the first payment's to the one it is
    // due in, or the one before that when finishing early.
    const problems: Record<string, string> = {};
    const spans = input.items.map((item, index) => {
      const lastSeq = seqOf(item.dueDate)! - (input.finishEarly ? 1 : 0);
      if (lastSeq < startSeq) {
        problems[`items.${index}.dueDate`] = "That's due in the first payment's period, so it can't finish a period earlier";
        return 0;
      }
      return lastSeq - startSeq + 1;
    });
    if (Object.keys(problems).length > 0) invalid(problems);

    const labels = input.items.map((item) => item.label);
    const planned = planShares(input.items.map((item, index) => ({ amountCents: item.amountCents, periods: spans[index]! })))
      .map((shares, offset) => {
        const period = periodAt(startSeq + offset);
        return {
          // The first goes when it was asked to; each after it on its period's first day,
          // which is never after a due date the period holds.
          occursAt: offset === 0 ? input.occursAt : atStartOfDay(period.startDate),
          cents: shares.reduce((sum, share) => sum + share.cents, 0),
          period,
          shares,
          // Only periods that may exist get a transaction; the rest are reported.
          reachable: startSeq + offset <= last.seq,
        };
      })
      .filter((payment) => payment.cents > 0);
    const payments = planned.filter((payment) => payment.reachable);
    const later = planned.filter((payment) => !payment.reachable);

    const tooLarge = payments.find((payment) => payment.cents > MAX_TRANSACTION_CENTS);
    if (tooLarge) {
      throw new AppError(
        400,
        "validation",
        `Together these come to more than ${formatCents(MAX_TRANSACTION_CENTS)} in one pay period. Split them separately.`,
      );
    }
    const notes = payments.map((payment) => splitNote(input.note, payment.shares, labels));
    const laterNotes = later.map((payment) => splitNote(input.note, payment.shares, labels));
    if ([...notes, ...laterNotes].some((note) => note.length > NOTE_LIMIT)) {
      invalid({ note: "With what each item makes up of every payment, the note gets too long. Shorten it or the item names." });
    }

    const rows: ImportRow[] = payments.map((payment, index) => ({
      name: input.name,
      amountCents: payment.cents,
      kind: input.kind,
      occursAt: payment.occursAt,
      note: notes[index],
      billIncomeId: input.billIncomeId,
      categoryId: input.categoryId,
    }));

    let imported;
    try {
      imported = await imports.importIn(repos, userId, { transactions: rows });
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

    const sign = input.kind === "expense" ? -1 : 1;

    // What can't be added yet waits, exactly as worked out, filed where the transactions
    // just made were: under the bill or income's own category when none was named.
    const waitingId = later.length > 0 ? randomUUID() : null;
    if (waitingId) {
      const billIncomeId = input.billIncomeId ?? null;
      const categoryId =
        input.categoryId !== undefined
          ? input.categoryId
          : billIncomeId
            ? ((await repos.billsIncome.findById(userId, billIncomeId))?.categoryId ?? null)
            : null;
      const createdAt = now();
      await repos.splitWaiting.createMany(
        later.map((payment, index) => ({
          id: randomUUID(),
          userId,
          splitId: waitingId,
          name: input.name,
          amountCents: sign * payment.cents,
          occursAt: payment.occursAt,
          note: laterNotes[index] || null,
          billIncomeId,
          categoryId,
          createdAt,
        })),
      );
    }

    return {
      dryRun: input.dryRun ?? false,
      payments: payments.map(({ occursAt, cents, period, shares }) => ({ occursAt, amountCents: sign * cents, period, shares })),
      later: later.map(({ occursAt, cents, period, shares }) => ({ occursAt, amountCents: sign * cents, period, shares })),
      waitingId,
      current: imported.current && {
        periodId: imported.current.periodId,
        projectedBeforeCents: imported.current.projectedBeforeCents,
        projectedAfterCents: imported.current.projectedAfterCents,
      },
    };
  }

  return {
    /**
     * Spreads each item evenly over the pay periods up to its due date and saves one
     * transaction per period, all or none. With `dryRun` the same work is done and undone,
     * so the plan returned is exactly what a real run would save.
     */
    async split(userId: string, input: TransactionSplitInput): Promise<TransactionSplitResponse> {
      try {
        return await store.transaction(async (repos) => {
          const result = await run(repos, userId, input);
          if (input.dryRun) throw new DryRunRollback(result);
          return result;
        });
      } catch (error) {
        if (error instanceof DryRunRollback) return error.result;
        throw error;
      }
    },

    /** Everything the user's splits have waiting, oldest split first, with whether each is worth a reminder. */
    async waiting(userId: string): Promise<WaitingSplitsResponse> {
      return store.transaction(async (repos) => {
        const reachEnd = await periods.reachEnd(repos, userId);
        const bySplit = new Map<string, SplitWaitingRecord[]>();
        for (const record of await repos.splitWaiting.listForUser(userId)) {
          const records = bySplit.get(record.splitId);
          if (records) records.push(record);
          else bySplit.set(record.splitId, [record]);
        }
        return { splits: [...bySplit.values()].map((records) => toWaitingSplit(records, reachEnd)) };
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

        await imports.importIn(repos, userId, {
          transactions: ready.map((record) => ({
            name: record.name,
            amountCents: Math.abs(record.amountCents),
            kind: record.amountCents < 0 ? "expense" : "income",
            occursAt: record.occursAt,
            note: record.note ?? undefined,
            billIncomeId: record.billIncomeId,
            categoryId: record.categoryId,
          })),
        });
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
