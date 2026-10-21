import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { splitWaitingPayments } from "../../db/schema.ts";
import type { SplitWaitingRepo } from "../types.ts";

export function createSplitWaitingRepo(db: Db): SplitWaitingRepo {
  const waiting = splitWaitingPayments;

  return {
    async createMany(records) {
      if (records.length > 0) await db.insert(waiting).values(records);
    },
    async listForUser(userId) {
      return db
        .select()
        .from(waiting)
        .where(eq(waiting.userId, userId))
        .orderBy(asc(waiting.occursAt), asc(waiting.splitId));
    },
    async listSplit(userId, splitId) {
      return db
        .select()
        .from(waiting)
        .where(and(eq(waiting.userId, userId), eq(waiting.splitId, splitId)))
        .orderBy(asc(waiting.occursAt));
    },
    async deleteMany(userId, ids) {
      if (ids.length === 0) return 0;
      const removed = await db
        .delete(waiting)
        .where(and(eq(waiting.userId, userId), inArray(waiting.id, ids)))
        .returning({ id: waiting.id });
      return removed.length;
    },
  };
}
