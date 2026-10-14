import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { categories } from "../../db/schema.ts";
import type { CategoryRepo } from "../types.ts";

export function createCategoryRepo(db: Db): CategoryRepo {
  const owned = (userId: string, id: string) => and(eq(categories.userId, userId), eq(categories.id, id));

  return {
    async findById(userId, id) {
      const [row] = await db.select().from(categories).where(owned(userId, id)).limit(1);
      return row ?? null;
    },
    async list(userId) {
      return db
        .select()
        .from(categories)
        .where(eq(categories.userId, userId))
        .orderBy(asc(sql`lower(${categories.name})`), asc(categories.createdAt));
    },
    async create(category) {
      await db.insert(categories).values(category);
      return category;
    },
    async update(userId, id, patch, now) {
      await db
        .update(categories)
        .set({ ...patch, updatedAt: now })
        .where(owned(userId, id));
    },
    async delete(userId, id) {
      await db.delete(categories).where(owned(userId, id));
    },
  };
}
