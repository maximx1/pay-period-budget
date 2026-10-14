import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { categories, periodCategoryLimits } from "../../db/schema.ts";
import type { CategoryLimitRepo } from "../types.ts";

export function createCategoryLimitRepo(db: Db): CategoryLimitRepo {
  const limits = periodCategoryLimits;
  const one = (userId: string, periodId: string, categoryId: string) =>
    and(eq(limits.userId, userId), eq(limits.periodId, periodId), eq(limits.categoryId, categoryId));

  return {
    async listForUser(userId) {
      return db.select().from(limits).where(eq(limits.userId, userId));
    },
    async listForPeriod(userId, periodId) {
      return db
        .select({
          periodId: limits.periodId,
          categoryId: limits.categoryId,
          userId: limits.userId,
          limitCents: limits.limitCents,
          createdAt: limits.createdAt,
          updatedAt: limits.updatedAt,
          categoryName: categories.name,
        })
        .from(limits)
        .innerJoin(categories, eq(categories.id, limits.categoryId))
        .where(and(eq(limits.userId, userId), eq(limits.periodId, periodId)))
        .orderBy(asc(sql`lower(${categories.name})`), asc(categories.createdAt));
    },
    async set(limit) {
      await db
        .insert(limits)
        .values(limit)
        .onConflictDoUpdate({
          target: [limits.periodId, limits.categoryId],
          set: { limitCents: limit.limitCents, updatedAt: limit.updatedAt },
        });
    },
    async delete(userId, periodId, categoryId) {
      const removed = await db
        .delete(limits)
        .where(one(userId, periodId, categoryId))
        .returning({ categoryId: limits.categoryId });
      return removed.length > 0;
    },
  };
}
