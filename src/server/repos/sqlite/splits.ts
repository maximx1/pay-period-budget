import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { splitItems, splits } from "../../db/schema.ts";
import type { SplitRepo } from "../types.ts";

export function createSplitRepo(db: Db): SplitRepo {
  return {
    async create(split) {
      await db.insert(splits).values(split);
    },
    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(splits)
        .where(and(eq(splits.userId, userId), eq(splits.id, id)))
        .limit(1);
      return row ?? null;
    },
    async listForUser(userId) {
      return db.select().from(splits).where(eq(splits.userId, userId)).orderBy(asc(splits.createdAt), asc(splits.id));
    },
    async update(userId, id, patch, now) {
      await db
        .update(splits)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(splits.userId, userId), eq(splits.id, id)));
    },
    async createItems(items) {
      if (items.length > 0) await db.insert(splitItems).values(items);
    },
    async renameItem(userId, id, label) {
      await db
        .update(splitItems)
        .set({ label })
        .where(and(eq(splitItems.userId, userId), eq(splitItems.id, id)));
    },
    async listItems(userId, splitId) {
      return db
        .select()
        .from(splitItems)
        .where(and(eq(splitItems.userId, userId), eq(splitItems.splitId, splitId)))
        .orderBy(asc(splitItems.position));
    },
    async listItemsForUser(userId) {
      return db
        .select()
        .from(splitItems)
        .where(eq(splitItems.userId, userId))
        .orderBy(asc(splitItems.splitId), asc(splitItems.position));
    },
  };
}
