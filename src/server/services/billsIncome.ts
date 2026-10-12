import { randomUUID } from "node:crypto";
import { dateOf, type LocalDate } from "../../shared/dates.ts";
import { describeRecurrence, nextOccurrence } from "../../shared/recurrence.ts";
import {
  AMOUNT_NEEDED_MESSAGE,
  END_BEFORE_START_MESSAGE,
  type BillOrIncomeInput,
  type BillOrIncome,
  type BillOrIncomePatch,
  type BillOrIncomePreview,
  type BillOrIncomeTransactionsQuery,
  type BillOrIncomeTransactionsResponse,
} from "../../shared/billsIncome.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore, BillOrIncomeRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";
import { materializeInPeriod, ruleOf } from "./materialize.ts";
import type { PeriodService } from "./periods.ts";
import { toTransaction } from "./transactionMapper.ts";

export type BillsIncomeService = ReturnType<typeof createBillsIncomeService>;

const notFound = () => new AppError(404, "not_found", "No such bill or income");

function toItem(record: BillOrIncomeRecord, today: LocalDate): BillOrIncome {
  const rule = ruleOf(record);
  const archived = record.endDate !== null && record.endDate < today;
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    kind: record.kind,
    defaultAmountCents: record.defaultAmountCents,
    recurrenceUnit: record.recurrenceUnit,
    recurrenceInterval: record.recurrenceInterval,
    firstDueDate: record.firstDueDate,
    endDate: record.endDate,
    archived,
    nextDueDate: archived ? null : nextOccurrence(rule, today),
    scheduleText: describeRecurrence(rule),
  };
}

export function createBillsIncomeService(deps: { store: DataStore; periods: PeriodService; now?: () => Date }) {
  const { store, periods, now = () => new Date() } = deps;

  /** `today` stands in for the first due date of an item with no schedule, which has none. */
  const draft = (userId: string, input: BillOrIncomeInput, createdAt: Date, today: LocalDate): BillOrIncomeRecord => ({
    id: randomUUID(),
    userId,
    name: input.name,
    description: input.description,
    kind: input.kind,
    defaultAmountCents: input.defaultAmountCents,
    recurrenceUnit: input.recurrenceUnit,
    recurrenceInterval: input.recurrenceInterval,
    firstDueDate: input.firstDueDate ?? today,
    endDate: input.endDate,
    createdAt,
    updatedAt: createdAt,
  });

  return {
    async list(userId: string): Promise<BillOrIncome[]> {
      const today = await periods.today(store, userId);
      return (await store.billsIncome.list(userId)).map((record) => toItem(record, today));
    },

    /**
     * Saves the item and adds its transactions to every period that already exists, from
     * the one containing its first due date onward. A first due date in the past therefore
     * back-fills earlier periods; `preview` reports that before the user commits to it.
     */
    create(userId: string, input: BillOrIncomeInput): Promise<BillOrIncome> {
      return store.transaction(async (repos) => {
        const today = await periods.today(repos, userId);
        const createdAt = now();
        const record = await repos.billsIncome.create(draft(userId, input, createdAt, today));

        // Ascending, so each period's change has reached the later ones before they add their own.
        for (const period of await repos.periods.listAll(userId)) {
          const { sumCents } = await materializeInPeriod(repos, record, period, createdAt);
          await applyLeftoverDelta(repos, userId, period.seq, sumCents, createdAt);
        }
        return toItem(record, today);
      });
    },

    /** What `create` would add to existing periods, without saving anything. */
    async preview(userId: string, input: BillOrIncomeInput): Promise<BillOrIncomePreview> {
      const today = await periods.today(store, userId);
      const record = draft(userId, input, now(), today);
      const preview: BillOrIncomePreview = { transactions: 0, periods: 0, pastPeriods: 0, earliestDate: null };

      for (const period of await store.periods.listAll(userId)) {
        const { count, dates } = await materializeInPeriod(store, record, period, record.createdAt, { dryRun: true });
        if (count === 0) continue;
        preview.transactions += count;
        preview.periods += 1;
        if (period.endDate < today) preview.pastPeriods += 1;
        preview.earliestDate ??= dates[0] ?? null;
      }
      return preview;
    },

    /** Changes the template only. Transactions that already exist are never touched. */
    update(userId: string, id: string, patch: BillOrIncomePatch): Promise<BillOrIncome> {
      return store.transaction(async (repos) => {
        const before = await repos.billsIncome.findById(userId, id);
        if (!before) throw notFound();

        const updatedAt = now();
        const after: BillOrIncomeRecord = { ...before, updatedAt };
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) Object.assign(after, { [key]: value });
        }

        const datesTouched = patch.firstDueDate !== undefined || patch.endDate !== undefined;
        if (datesTouched && after.endDate !== null && after.endDate < after.firstDueDate) {
          throw new AppError(400, "validation", "Some fields need attention", { endDate: END_BEFORE_START_MESSAGE });
        }
        // Only an item with no schedule may go without a usual amount.
        if (after.recurrenceUnit !== "none" && after.defaultAmountCents === 0) {
          throw new AppError(400, "validation", "Some fields need attention", {
            defaultAmountCents: AMOUNT_NEEDED_MESSAGE,
          });
        }

        const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, ...changes } = after;
        await repos.billsIncome.update(userId, id, changes, updatedAt);
        return toItem(after, await periods.today(repos, userId));
      });
    },

    /**
     * One page of everything tied to the item, generated or linked afterwards, newest
     * first, with totals over all of it. Reads only.
     */
    async transactions(
      userId: string,
      id: string,
      { limit, before }: BillOrIncomeTransactionsQuery,
    ): Promise<BillOrIncomeTransactionsResponse> {
      if (!(await store.billsIncome.findById(userId, id))) throw notFound();

      const separator = before?.indexOf("_") ?? -1;
      const position = before ? { occursAt: before.slice(0, separator), id: before.slice(separator + 1) } : undefined;
      // One more than asked for says whether anything older remains.
      const records = await store.transactions.listForBillOrIncome(userId, id, { limit: limit + 1, before: position });
      const page = records.slice(0, limit);
      const last = page.at(-1);
      return {
        transactions: page.map(toTransaction),
        nextCursor: records.length > limit && last ? `${last.occursAt}_${last.id}` : null,
        totals: await store.transactions.sumForBillOrIncome(userId, id),
      };
    },

    /** Deletes the template. Its transactions stay, no longer linked to it. */
    remove(userId: string, id: string): Promise<void> {
      return store.transaction(async (repos) => {
        if (!(await repos.billsIncome.findById(userId, id))) throw notFound();
        await repos.billsIncome.delete(userId, id);
      });
    },

    /**
     * Stops the item as of today, so it produces nothing further and is archived from
     * tomorrow. Optionally also deletes its upcoming transactions dated after today.
     */
    end(userId: string, id: string, options: { removeUpcoming: boolean }): Promise<BillOrIncome> {
      return store.transaction(async (repos) => {
        const record = await repos.billsIncome.findById(userId, id);
        if (!record) throw notFound();

        const today = await periods.today(repos, userId);
        const updatedAt = now();
        const endDate = record.endDate !== null && record.endDate < today ? record.endDate : today;
        await repos.billsIncome.update(userId, id, { endDate }, updatedAt);

        if (options.removeUpcoming) {
          for (const transaction of await repos.transactions.listUpcomingForBillOrIncomeAfter(userId, id, today)) {
            const period = await repos.periods.findContaining(userId, dateOf(transaction.occursAt));
            await repos.transactions.delete(userId, transaction.id);
            if (period) await applyLeftoverDelta(repos, userId, period.seq, -transaction.amountCents, updatedAt);
          }
        }
        return toItem({ ...record, endDate, updatedAt }, today);
      });
    },
  };
}
