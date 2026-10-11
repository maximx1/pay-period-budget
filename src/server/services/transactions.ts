import { randomUUID } from "node:crypto";
import { dateOf, type LocalDateTime } from "../../shared/dates.ts";
import type {
  TransactionInput,
  TransactionKind,
  TransactionPatch,
  TransactionResponse,
} from "../../shared/transactions.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore, PeriodRecord, Repos, TransactionRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";
import type { PeriodService } from "./periods.ts";
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

  const respond = (record: TransactionRecord, period: PeriodRecord): TransactionResponse => ({
    transaction: toTransaction(record),
    period: { id: period.id, startDate: period.startDate, endDate: period.endDate },
  });

  return {
    create(userId: string, input: TransactionInput): Promise<TransactionResponse> {
      return store.transaction(async (repos) => {
        const period = await periodFor(repos, userId, input.occursAt);
        const createdAt = now();
        const record = await repos.transactions.create({
          id: randomUUID(),
          userId,
          name: input.name,
          amountCents: signed(input.amountCents, input.kind),
          occursAt: input.occursAt,
          status: input.paid ? "paid" : "upcoming",
          paidAt: input.paid ? createdAt : null,
          sortOrder: 0,
          note: input.note || null,
          createdAt,
          updatedAt: createdAt,
        });
        await applyLeftoverDelta(repos, userId, period.seq, record.amountCents, createdAt);
        return respond(record, period);
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

        const oldPeriod = await repos.periods.findContaining(userId, dateOf(before.occursAt));
        const newPeriod =
          oldPeriod && after.occursAt === before.occursAt ? oldPeriod : await periodFor(repos, userId, after.occursAt);

        const { name, amountCents, occursAt, paidAt, note } = after;
        await repos.transactions.update(userId, id, { name, amountCents, occursAt, status, paidAt, note }, updatedAt);

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

    remove(userId: string, id: string): Promise<void> {
      return store.transaction(async (repos) => {
        const record = await repos.transactions.findById(userId, id);
        if (!record) throw notFound();

        const period = await repos.periods.findContaining(userId, dateOf(record.occursAt));
        await repos.transactions.delete(userId, id);
        if (period) await applyLeftoverDelta(repos, userId, period.seq, -record.amountCents, now());
      });
    },
  };
}
