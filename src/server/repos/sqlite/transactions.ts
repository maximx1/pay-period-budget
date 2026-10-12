import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { addDays, atStartOfDay, type LocalDate } from "../../../shared/dates.ts";
import type { Db } from "../../db/client.ts";
import { deletedImportKeys, transactions } from "../../db/schema.ts";
import type { TransactionRepo } from "../types.ts";
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
        .onConflictDoNothing({ target: [transactions.recurringId, transactions.occurrenceDate] })
        .returning({ id: transactions.id });
      return inserted.length > 0;
    },
    async listUpcomingForRecurringAfter(userId, recurringId, date) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.recurringId, recurringId),
            eq(transactions.status, "upcoming"),
            gte(transactions.occursAt, atStartOfDay(addDays(date, 1))),
          ),
        )
        .orderBy(asc(transactions.occursAt));
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
