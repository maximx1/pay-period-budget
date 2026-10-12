import { randomUUID } from "node:crypto";
import { dateOf, type LocalDateTime } from "../../shared/dates.ts";
import type {
  TransactionInput,
  TransactionKind,
  Transaction,
  TransactionPatch,
  TransactionRange,
  TransactionResponse,
} from "../../shared/transactions.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore, PeriodRecord, Repos, TransactionRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";
import type { PeriodService } from "./periods.ts";
import { createLinkPlanner } from "./recurringLinks.ts";
import { toTransaction } from "./transactionMapper.ts";

export type TransactionService = ReturnType<typeof createTransactionService>;

const signed = (amountCents: number, kind: TransactionKind) => (kind === "expense" ? -amountCents : amountCents);
const notFound = () => new AppError(404, "not_found", "No such transaction");

export function createTransactionService(deps: { store: DataStore; periods: PeriodService; now?: () => Date }) {
  const { store, periods, now = () => new Date() } = deps;

  /** The period a date-time falls in, generating periods up to it if needed. */
  async function periodFor(repos: Repos, userId: string, occursAt: LocalDateTime): Promise<PeriodRecord> {
    const date = dateOf(occursAt);
    try {
      await periods.ensureThrough(repos, userId, date);
    } catch (error) {
      // The period service talks about "date"; here the field is the transaction's occursAt.
      if (error instanceof AppError && error.fields?.date) {
        throw new AppError(400, "validation", error.message, { occursAt: error.fields.date });
      }
      throw error;
    }
    const period = await repos.periods.findContaining(userId, date);
    if (!period) throw new Error(`No period covers ${date} after generating through it`);
    return period;
  }

  /** Where a transaction arriving at this date and time goes: after everything already there. */
  async function lastPlaceAt(repos: Repos, userId: string, occursAt: LocalDateTime): Promise<number> {
    const max = await repos.transactions.maxSortOrderAt(userId, occursAt);
    return max === null ? 0 : max + 1;
  }

  const linkError = (problems: Record<string, string>) =>
    new AppError(400, "validation", Object.values(problems)[0] ?? "Some fields need attention", problems);

  const respond = (record: TransactionRecord, period: PeriodRecord): TransactionResponse => ({
    transaction: toTransaction(record),
    period: { id: period.id, startDate: period.startDate, endDate: period.endDate },
  });

  return {
    /** Transactions dated within the range, in display order. Reads only: no period is generated. */
    async list(userId: string, { from, to }: TransactionRange): Promise<Transaction[]> {
      return (await store.transactions.listInRange(userId, from, to)).map(toTransaction);
    },

    create(userId: string, input: TransactionInput): Promise<TransactionResponse> {
      return store.transaction(async (repos) => {
        const amountCents = signed(input.amountCents, input.kind);
        const links = createLinkPlanner(repos, userId);
        const link = await links.plan({ recurringId: input.recurringId, countsToward: input.countsToward, amountCents });
        if ("problems" in link) throw linkError(link.problems);

        const period = await periodFor(repos, userId, input.occursAt);
        const createdAt = now();
        const record = await repos.transactions.create({
          id: randomUUID(),
          userId,
          name: input.name,
          amountCents,
          occursAt: input.occursAt,
          status: input.paid ? "paid" : "upcoming",
          paidAt: input.paid ? createdAt : null,
          sortOrder: await lastPlaceAt(repos, userId, input.occursAt),
          note: input.note || null,
          recurringId: link.recurringId,
          occurrenceDate: null,
          importKey: null,
          createdAt,
          updatedAt: createdAt,
        });
        await applyLeftoverDelta(repos, userId, period.seq, record.amountCents, createdAt);
        const [countedToward] = await links.apply(createdAt);
        return { ...respond(record, period), ...(countedToward && { countedToward }) };
      });
    },

    update(userId: string, id: string, patch: TransactionPatch): Promise<TransactionResponse> {
      return store.transaction(async (repos) => {
        const before = await repos.transactions.findById(userId, id);
        if (!before) throw notFound();

        const kind = patch.kind ?? (before.amountCents < 0 ? "expense" : "income");
        const status = patch.status ?? before.status;
        const updatedAt = now();
        const after: TransactionRecord = {
          ...before,
          name: patch.name ?? before.name,
          amountCents: signed(patch.amountCents ?? Math.abs(before.amountCents), kind),
          occursAt: patch.occursAt ?? before.occursAt,
          status,
          // Only a real change of status touches the paid timestamp.
          paidAt: status === before.status ? before.paidAt : status === "paid" ? updatedAt : null,
          note: patch.note === undefined ? before.note : patch.note || null,
          updatedAt,
        };
        if (patch.recurringId !== undefined && patch.recurringId !== before.recurringId) {
          const link = await createLinkPlanner(repos, userId).plan({ recurringId: patch.recurringId, amountCents: 0 });
          if ("problems" in link) throw linkError(link.problems);
          after.recurringId = link.recurringId;
          // Moved to another item it is no longer the occurrence its first item scheduled.
          // Untied, it keeps the date: that is still what it was.
          if (link.recurringId !== null) after.occurrenceDate = null;
        }
        // Moving to a different date and time means joining the end of whatever is already there.
        if (after.occursAt !== before.occursAt) after.sortOrder = await lastPlaceAt(repos, userId, after.occursAt);

        const oldPeriod = await repos.periods.findContaining(userId, dateOf(before.occursAt));
        const newPeriod =
          oldPeriod && after.occursAt === before.occursAt ? oldPeriod : await periodFor(repos, userId, after.occursAt);

        const { name, amountCents, occursAt, paidAt, note, sortOrder, recurringId, occurrenceDate } = after;
        await repos.transactions.update(
          userId,
          id,
          { name, amountCents, occursAt, status, paidAt, note, sortOrder, recurringId, occurrenceDate },
          updatedAt,
        );

        if (oldPeriod?.id === newPeriod.id) {
          await applyLeftoverDelta(repos, userId, newPeriod.seq, after.amountCents - before.amountCents, updatedAt);
        } else {
          // It left one period and joined another: undo it downstream of the old, add it downstream of the new.
          if (oldPeriod) await applyLeftoverDelta(repos, userId, oldPeriod.seq, -before.amountCents, updatedAt);
          await applyLeftoverDelta(repos, userId, newPeriod.seq, after.amountCents, updatedAt);
        }
        return respond(after, newPeriod);
      });
    },

    /**
     * Sets the display order of transactions that share one date and time: each takes the
     * position it has in `ids`. Order between different times always follows the time.
     */
    reorder(userId: string, ids: string[]): Promise<void> {
      return store.transaction(async (repos) => {
        const invalid = (message: string) => new AppError(400, "validation", message, { ids: message });
        const records: TransactionRecord[] = [];
        for (const id of ids) {
          const record = await repos.transactions.findById(userId, id);
          if (!record) throw invalid("One of those transactions doesn't exist");
          records.push(record);
        }
        if (records.some((record) => record.occursAt !== records[0]!.occursAt)) {
          throw invalid("Only transactions with the same date and time can be reordered");
        }

        const updatedAt = now();
        for (const [index, record] of records.entries()) {
          if (record.sortOrder !== index) {
            await repos.transactions.update(userId, record.id, { sortOrder: index }, updatedAt);
          }
        }
      });
    },

    remove(userId: string, id: string): Promise<void> {
      return store.transaction(async (repos) => {
        const record = await repos.transactions.findById(userId, id);
        if (!record) throw notFound();

        const period = await repos.periods.findContaining(userId, dateOf(record.occursAt));
        const deletedAt = now();
        await repos.transactions.delete(userId, id);
        // Remembered, so the next import of a file that still lists this row leaves it out.
        if (record.importKey !== null) {
          await repos.transactions.rememberDeletedImportKey(userId, record.importKey, deletedAt);
        }
        if (period) await applyLeftoverDelta(repos, userId, period.seq, -record.amountCents, deletedAt);
      });
    },
  };
}
