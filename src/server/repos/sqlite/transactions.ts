import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { addDays, atStartOfDay, type LocalDate } from "../../../shared/dates.ts";
import type { Db } from "../../db/client.ts";
import { deletedImportKeys, transactions } from "../../db/schema.ts";
import type { TransactionRepo, TransactionSearch } from "../types.ts";
import { rethrowConstraint } from "./errors.ts";

// Rows per statement, kept well under SQLite's limit on bound values.
const BATCH = 100;

/** occurs_at is sortable text, so a date range is the half-open interval [start 00:00, day after end 00:00). */
function inRange(userId: string, startDate: LocalDate, endDate: LocalDate) {
  return and(
    eq(transactions.userId, userId),
    gte(transactions.occursAt, atStartOfDay(startDate)),
    lt(transactions.occursAt, atStartOfDay(addDays(endDate, 1))),
  );
}

/** The conditions a search puts on a user's transactions. */
function matching(userId: string, { text, from, to, categoryId }: TransactionSearch) {
  // The text is matched literally: its own % and _ are not wildcards.
  const pattern = text === undefined ? undefined : `%${text.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
  return and(
    eq(transactions.userId, userId),
    pattern === undefined
      ? undefined
      : or(
          sql`lower(${transactions.name}) like ${pattern} escape '\\'`,
          sql`lower(coalesce(${transactions.note}, '')) like ${pattern} escape '\\'`,
        ),
    from === undefined ? undefined : gte(transactions.occursAt, atStartOfDay(from)),
    to === undefined ? undefined : lt(transactions.occursAt, atStartOfDay(addDays(to, 1))),
    categoryId === undefined
      ? undefined
      : categoryId === null
        ? isNull(transactions.categoryId)
        : eq(transactions.categoryId, categoryId),
  );
}

export function createTransactionRepo(db: Db): TransactionRepo {
  return {
    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .limit(1);
      return row ?? null;
    },
    async listInRange(userId, startDate, endDate) {
      return db
        .select()
        .from(transactions)
        .where(inRange(userId, startDate, endDate))
        .orderBy(asc(transactions.occursAt), asc(transactions.sortOrder), asc(transactions.createdAt));
    },
    async sumInRange(userId, startDate, endDate) {
      const sumWhere = (status: "paid" | "upcoming") =>
        sql<number>`coalesce(sum(case when ${transactions.status} = ${status} then ${transactions.amountCents} end), 0)`;
      const [row] = await db
        .select({ paidCents: sumWhere("paid"), upcomingCents: sumWhere("upcoming") })
        .from(transactions)
        .where(inRange(userId, startDate, endDate));
      return { paidCents: Number(row?.paidCents ?? 0), upcomingCents: Number(row?.upcomingCents ?? 0) };
    },
    async maxSortOrderAt(userId, occursAt) {
      const [row] = await db
        .select({ max: sql<number | null>`max(${transactions.sortOrder})` })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.occursAt, occursAt)));
      return row?.max ?? null;
    },
    async create(transaction) {
      await db.insert(transactions).values(transaction);
      return transaction;
    },
    async createMany(records) {
      for (let i = 0; i < records.length; i += BATCH) {
        await db
          .insert(transactions)
          .values(records.slice(i, i + BATCH))
          .catch(rethrowConstraint);
      }
    },
    async findImportKeys(userId, importKeys) {
      const found: string[] = [];
      for (let i = 0; i < importKeys.length; i += BATCH) {
        const rows = await db
          .select({ importKey: transactions.importKey })
          .from(transactions)
          .where(and(eq(transactions.userId, userId), inArray(transactions.importKey, importKeys.slice(i, i + BATCH))));
        for (const row of rows) if (row.importKey !== null) found.push(row.importKey);
      }
      return found;
    },
    async rememberDeletedImportKey(userId, importKey, now) {
      await db.insert(deletedImportKeys).values({ userId, importKey, deletedAt: now }).onConflictDoNothing();
    },
    async findDeletedImportKeys(userId, importKeys) {
      const found: string[] = [];
      for (let i = 0; i < importKeys.length; i += BATCH) {
        const rows = await db
          .select({ importKey: deletedImportKeys.importKey })
          .from(deletedImportKeys)
          .where(
            and(eq(deletedImportKeys.userId, userId), inArray(deletedImportKeys.importKey, importKeys.slice(i, i + BATCH))),
          );
        found.push(...rows.map((row) => row.importKey));
      }
      return found;
    },
    async forgetDeletedImportKeys(userId, importKeys) {
      for (let i = 0; i < importKeys.length; i += BATCH) {
        await db
          .delete(deletedImportKeys)
          .where(
            and(eq(deletedImportKeys.userId, userId), inArray(deletedImportKeys.importKey, importKeys.slice(i, i + BATCH))),
          );
      }
    },
    async createIfAbsent(transaction) {
      const inserted = await db
        .insert(transactions)
        .values(transaction)
        .onConflictDoNothing({ target: [transactions.billIncomeId, transactions.occurrenceDate] })
        .returning({ id: transactions.id });
      return inserted.length > 0;
    },
    async listForBillOrIncome(userId, billIncomeId, { limit, before }) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.billIncomeId, billIncomeId),
            // The id breaks ties between transactions at the same moment, so a page boundary
            // that falls among them neither repeats nor skips one.
            before &&
              or(
                lt(transactions.occursAt, before.occursAt),
                and(eq(transactions.occursAt, before.occursAt), lt(transactions.id, before.id)),
              ),
          ),
        )
        .orderBy(desc(transactions.occursAt), desc(transactions.id))
        .limit(limit);
    },
    async listLinkedDescriptions(userId) {
      const rows = await db
        .select({
          billIncomeId: transactions.billIncomeId,
          name: transactions.name,
          note: transactions.note,
          lastUsedAt: sql<string>`max(${transactions.occursAt})`,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNotNull(transactions.billIncomeId)))
        .groupBy(transactions.billIncomeId, transactions.name, transactions.note);
      return rows.flatMap((row) => (row.billIncomeId === null ? [] : [{ ...row, billIncomeId: row.billIncomeId }]));
    },
    async sumForBillOrIncome(userId, billIncomeId) {
      const sumWhere = (status: "paid" | "upcoming") =>
        sql<number>`coalesce(sum(case when ${transactions.status} = ${status} then ${transactions.amountCents} end), 0)`;
      const paid = sql`${transactions.status} = 'paid'`;
      const [row] = await db
        .select({
          count: sql<number>`count(*)`,
          paidCents: sumWhere("paid"),
          upcomingCents: sumWhere("upcoming"),
          paidOutCents: sql<number>`coalesce(sum(case when ${paid} and ${transactions.amountCents} < 0 then -${transactions.amountCents} end), 0)`,
          paidInCents: sql<number>`coalesce(sum(case when ${paid} and ${transactions.amountCents} > 0 then ${transactions.amountCents} end), 0)`,
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.billIncomeId, billIncomeId)));
      return {
        count: Number(row?.count ?? 0),
        paidCents: Number(row?.paidCents ?? 0),
        upcomingCents: Number(row?.upcomingCents ?? 0),
        paidOutCents: Number(row?.paidOutCents ?? 0),
        paidInCents: Number(row?.paidInCents ?? 0),
      };
    },
    async listUpcomingForBillOrIncomeAfter(userId, billIncomeId, date) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.billIncomeId, billIncomeId),
            isNotNull(transactions.occurrenceDate),
            eq(transactions.status, "upcoming"),
            gte(transactions.occursAt, atStartOfDay(addDays(date, 1))),
          ),
        )
        .orderBy(asc(transactions.occursAt));
    },
    async search(userId, criteria, { limit, before }) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            matching(userId, criteria),
            before &&
              or(
                lt(transactions.occursAt, before.occursAt),
                and(eq(transactions.occursAt, before.occursAt), lt(transactions.id, before.id)),
              ),
          ),
        )
        .orderBy(desc(transactions.occursAt), desc(transactions.id))
        .limit(limit);
    },
    async searchTotals(userId, criteria) {
      const [row] = await db
        .select({
          count: sql<number>`count(*)`,
          outCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} end), 0)`,
          inCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} end), 0)`,
        })
        .from(transactions)
        .where(matching(userId, criteria));
      return { count: Number(row?.count ?? 0), outCents: Number(row?.outCents ?? 0), inCents: Number(row?.inCents ?? 0) };
    },
    async setCategoryForBillOrIncome(userId, billIncomeId, categoryId, now) {
      const changed = await db
        .update(transactions)
        .set({ categoryId, updatedAt: now })
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.billIncomeId, billIncomeId),
            // "is not" also tells a category from none, which "<>" does not.
            sql`${transactions.categoryId} is not ${categoryId}`,
          ),
        )
        .returning({ id: transactions.id });
      return changed.length;
    },
    async update(userId, id, patch, now) {
      await db
        .update(transactions)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
    },
    async delete(userId, id) {
      await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
    },
  };
}
