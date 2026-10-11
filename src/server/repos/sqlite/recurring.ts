import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { recurringItems } from "../../db/schema.ts";
import type { RecurringRepo } from "../types.ts";

export function createRecurringRepo(db: Db): RecurringRepo {
  const owned = (userId: string, id: string) => and(eq(recurringItems.userId, userId), eq(recurringItems.id, id));

  return {
    async findById(userId, id) {
      const [row] = await db.select().from(recurringItems).where(owned(userId, id)).limit(1);
      return row ?? null;
    },
    async list(userId) {
      return db
        .select()
        .from(recurringItems)
        .where(eq(recurringItems.userId, userId))
        .orderBy(asc(sql`lower(${recurringItems.name})`), asc(recurringItems.createdAt));
    },
    async create(item) {
      await db.insert(recurringItems).values(item);
      return item;
    },
    async update(userId, id, patch, now) {
      await db
        .update(recurringItems)
        .set({ ...patch, updatedAt: now })
        .where(owned(userId, id));
    },
    async delete(userId, id) {
      await db.delete(recurringItems).where(owned(userId, id));
    },
  };
}
