import { randomUUID } from "node:crypto";
import { dateOf, diffDays, addDays, type LocalDate, type LocalDateTime } from "../../shared/dates.ts";
import {
  DUPLICATE_WINDOW_DAYS,
  type ImportRow,
  type PossibleDuplicate,
  type TransactionImportInput,
  type TransactionImportResponse,
} from "../../shared/transactions.ts";
import { AppError } from "../lib/errors.ts";
import type { DataStore, PeriodRecord, Repos, TransactionRecord } from "../repos/types.ts";
import { applyLeftoverDelta } from "./carry.ts";
import { type PeriodService, TOO_FAR_BACK } from "./periods.ts";
import { toTransaction } from "./transactionMapper.ts";

export type ImportService = ReturnType<typeof createImportService>;

/** Carries a dry run's result out of its transaction, which rolls back because this was thrown. */
class DryRunRollback extends Error {
  constructor(readonly result: TransactionImportResponse) {
    super("Dry run: nothing saved");
  }
}

const signed = (row: ImportRow) => (row.kind === "expense" ? -row.amountCents : row.amountCents);

/** Which kinds of existing transaction are the likelier match, likeliest first. */
const REASON_RANK: Record<PossibleDuplicate["reason"], number> = { recurring: 0, manual: 1, imported: 2 };

export function createImportService(deps: { store: DataStore; periods: PeriodService; now?: () => Date }) {
  const { store, periods, now = () => new Date() } = deps;

  /** The two leftover figures of the period containing today, or null if no period covers it. */
  async function currentFigures(repos: Repos, userId: string) {
    const today = await periods.today(repos, userId);
    try {
      await periods.ensureThrough(repos, userId, today);
    } catch (error) {
      if (!(error instanceof AppError && error.fields?.date)) throw error;
    }
    const period = await repos.periods.findContaining(userId, today);
    if (!period) return null;
    const { paidCents, upcomingCents } = await repos.transactions.sumInRange(userId, period.startDate, period.endDate);
    return {
      periodId: period.id,
      leftoverCents: period.startingCents + paidCents,
      projectedCents: period.startingCents + paidCents + upcomingCents,
    };
  }

  /**
   * For each incoming row, the closest transaction already held that has the same signed
   * amount and a date within the window. One that was itself imported has a key of its
   * own, so a different key normally means a different payment: it is only reported when
   * the date and name match too, which is what a changed way of making keys looks like.
   */
  function findPossibleDuplicates(
    rows: Array<{ index: number; row: ImportRow }>,
    existing: TransactionRecord[],
  ): PossibleDuplicate[] {
    const byAmount = new Map<number, TransactionRecord[]>();
    for (const record of existing) {
      const sameAmount = byAmount.get(record.amountCents);
      if (sameAmount) sameAmount.push(record);
      else byAmount.set(record.amountCents, [record]);
    }

    const found: PossibleDuplicate[] = [];
    for (const { index, row } of rows) {
      const date = dateOf(row.occursAt);
      let best: Omit<PossibleDuplicate, "index" | "existing"> & { record: TransactionRecord } | null = null;

      for (const record of byAmount.get(signed(row)) ?? []) {
        const daysApart = Math.abs(diffDays(date, dateOf(record.occursAt)));
        if (daysApart > DUPLICATE_WINDOW_DAYS) continue;

        let reason: PossibleDuplicate["reason"];
        if (record.importKey !== null) {
          if (daysApart !== 0 || record.name.toLowerCase() !== row.name.toLowerCase()) continue;
          reason = "imported";
        } else {
          reason = record.recurringId !== null ? "recurring" : "manual";
        }
        const closer =
          !best ||
          daysApart < best.daysApart ||
          (daysApart === best.daysApart && REASON_RANK[reason] < REASON_RANK[best.reason]);
        if (closer) best = { record, reason, daysApart };
      }
      if (best) found.push({ index, existing: toTransaction(best.record), reason: best.reason, daysApart: best.daysApart });
    }
    return found;
  }

  async function run(repos: Repos, userId: string, input: TransactionImportInput): Promise<TransactionImportResponse> {
    const rows = input.transactions.map((row, index) => ({ index, row }));
    const before = await currentFigures(repos, userId);

    // Make room: the periods the rows need, as far as they are allowed to exist.
    const dates = rows.map(({ row }) => dateOf(row.occursAt)).sort();
    const periodsAdded = await periods.extendToward(
      repos,
      userId,
      { from: dates[0]!, to: dates.at(-1)! },
      { addEarlier: input.addEarlierPeriods ?? false },
    );

    // Every row must now fall in a period. Nothing is saved unless they all do.
    const allPeriods = await repos.periods.listAll(userId);
    const first = allPeriods[0]!;
    const last = allPeriods.at(-1)!;
    const periodOf = (date: LocalDate): PeriodRecord | undefined =>
      allPeriods.find((period) => period.startDate <= date && date <= period.endDate);

    const fields: Record<string, string> = {};
    for (const { index, row } of rows) {
      const date = dateOf(row.occursAt);
      if (date < first.startDate) {
        fields[`transactions.${index}.occursAt`] = input.addEarlierPeriods
          ? TOO_FAR_BACK
          : first.seq < 0
            ? "That's before your earliest pay period"
            : "That's before your budget started";
      } else if (date > last.endDate) {
        fields[`transactions.${index}.occursAt`] = "That's more than a year ahead";
      }
    }
    if (Object.keys(fields).length > 0) {
      const count = Object.keys(fields).length;
      throw new AppError(
        400,
        "validation",
        `${count} of the ${rows.length} transactions ${count === 1 ? "is" : "are"} dated outside your pay periods. Nothing was imported.`,
        fields,
      );
    }

    // Rows the account already holds are left out; that is what makes a second run harmless.
    const keys = rows.flatMap(({ row }) => (row.importKey === undefined ? [] : [row.importKey]));
    const held = new Set(keys.length > 0 ? await repos.transactions.findImportKeys(userId, keys) : []);
    const skipped: TransactionImportResponse["skipped"] = [];
    const fresh: typeof rows = [];
    for (const entry of rows) {
      const key = entry.row.importKey;
      if (key !== undefined && held.has(key)) skipped.push({ index: entry.index, importKey: key });
      else fresh.push(entry);
    }

    // What is already around the incoming dates, including anything the new periods just generated.
    const nearby =
      fresh.length === 0
        ? []
        : await repos.transactions.listInRange(
            userId,
            addDays(dates[0]!, -DUPLICATE_WINDOW_DAYS),
            addDays(dates.at(-1)!, DUPLICATE_WINDOW_DAYS),
          );
    const possibleDuplicates = findPossibleDuplicates(fresh, nearby);

    // A row joins the end of whatever already shares its date and time, in the order given.
    const nextPlace = new Map<LocalDateTime, number>();
    for (const record of nearby) {
      nextPlace.set(record.occursAt, Math.max(nextPlace.get(record.occursAt) ?? 0, record.sortOrder + 1));
    }

    const createdAt = now();
    const perPeriod = new Map<string, { period: PeriodRecord; count: number; netCents: number }>();
    const records: TransactionRecord[] = fresh.map(({ row }) => {
      const period = periodOf(dateOf(row.occursAt))!;
      const amountCents = signed(row);
      const tally = perPeriod.get(period.id) ?? { period, count: 0, netCents: 0 };
      tally.count += 1;
      tally.netCents += amountCents;
      perPeriod.set(period.id, tally);

      const sortOrder = nextPlace.get(row.occursAt) ?? 0;
      nextPlace.set(row.occursAt, sortOrder + 1);
      return {
        id: randomUUID(),
        userId,
        name: row.name,
        amountCents,
        occursAt: row.occursAt,
        status: row.paid ? "paid" : "upcoming",
        paidAt: row.paid ? createdAt : null,
        sortOrder,
        note: row.note || null,
        recurringId: null,
        occurrenceDate: null,
        importKey: row.importKey ?? null,
        createdAt,
        updatedAt: createdAt,
      };
    });
    await repos.transactions.createMany(records);

    // One carry per period rather than one per row: the result is the same, since each
    // row's effect on later (or, before the budget, earlier) starting amounts simply adds up.
    const touched = [...perPeriod.values()].sort((a, b) => a.period.seq - b.period.seq);
    for (const { period, netCents } of touched) {
      await applyLeftoverDelta(repos, userId, period.seq, netCents, createdAt);
    }

    const after = await currentFigures(repos, userId);
    return {
      dryRun: input.dryRun ?? false,
      created: records.length,
      skipped,
      periodsAdded,
      periods: touched.map(({ period, count, netCents }) => ({
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        count,
        netCents,
      })),
      possibleDuplicates,
      current:
        before && after
          ? {
              periodId: after.periodId,
              leftoverBeforeCents: before.leftoverCents,
              leftoverAfterCents: after.leftoverCents,
              projectedBeforeCents: before.projectedCents,
              projectedAfterCents: after.projectedCents,
            }
          : null,
    };
  }

  return {
    /**
     * Saves many transactions at once, all or none. With `dryRun` the same work is done
     * and then undone, so the report describes exactly what a real run would do.
     */
    async importTransactions(userId: string, input: TransactionImportInput): Promise<TransactionImportResponse> {
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
  };
}
