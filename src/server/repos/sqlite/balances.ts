import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { balanceChecks, trackedBalances } from "../../db/schema.ts";
import type { BalanceRepo } from "../types.ts";

export function createBalanceRepo(db: Db): BalanceRepo {
  const tracked = trackedBalances;
  const checks = balanceChecks;
  const trackedRow = (userId: string, billIncomeId: string) =>
    and(eq(tracked.userId, userId), eq(tracked.billIncomeId, billIncomeId));

  return {
    async listTracked(userId) {
      return db.select().from(tracked).where(eq(tracked.userId, userId));
    },
    async findTracked(userId, billIncomeId) {
      const [row] = await db.select().from(tracked).where(trackedRow(userId, billIncomeId)).limit(1);
      return row ?? null;
    },
    async track(record) {
      await db.insert(tracked).values(record);
    },
    async updateTracked(userId, billIncomeId, patch, now) {
      await db
        .update(tracked)
        .set({ ...patch, updatedAt: now })
        .where(trackedRow(userId, billIncomeId));
    },
    async untrack(userId, billIncomeId) {
      const removed = await db
        .delete(tracked)
        .where(trackedRow(userId, billIncomeId))
        .returning({ id: tracked.billIncomeId });
      return removed.length > 0;
    },
    async addCheck(check) {
      await db.insert(checks).values(check);
    },
    async listChecks(userId, billIncomeId) {
      return db
        .select()
        .from(checks)
        .where(and(eq(checks.userId, userId), eq(checks.billIncomeId, billIncomeId)))
        .orderBy(desc(checks.asOf), desc(checks.createdAt));
    },
    async findCheck(userId, id) {
      const [row] = await db
        .select()
        .from(checks)
        .where(and(eq(checks.userId, userId), eq(checks.id, id)))
        .limit(1);
      return row ?? null;
    },
    async deleteCheck(userId, id) {
      await db.delete(checks).where(and(eq(checks.userId, userId), eq(checks.id, id)));
    },
  };
}
