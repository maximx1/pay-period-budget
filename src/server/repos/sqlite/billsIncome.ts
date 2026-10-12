import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { billsIncome } from "../../db/schema.ts";
import type { BillsIncomeRepo } from "../types.ts";

export function createBillsIncomeRepo(db: Db): BillsIncomeRepo {
  const owned = (userId: string, id: string) => and(eq(billsIncome.userId, userId), eq(billsIncome.id, id));

  return {
    async findById(userId, id) {
      const [row] = await db.select().from(billsIncome).where(owned(userId, id)).limit(1);
      return row ?? null;
    },
    async list(userId) {
      return db
        .select()
        .from(billsIncome)
        .where(eq(billsIncome.userId, userId))
        .orderBy(asc(sql`lower(${billsIncome.name})`), asc(billsIncome.createdAt));
    },
    async create(item) {
      await db.insert(billsIncome).values(item);
      return item;
    },
    async update(userId, id, patch, now) {
      await db
        .update(billsIncome)
        .set({ ...patch, updatedAt: now })
        .where(owned(userId, id));
    },
    async delete(userId, id) {
      await db.delete(billsIncome).where(owned(userId, id));
    },
  };
}
