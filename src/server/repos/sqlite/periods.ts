import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { periods } from "../../db/schema.ts";
import type { PeriodRepo } from "../types.ts";
import { rethrowConstraint } from "./errors.ts";

export function createPeriodRepo(db: Db): PeriodRepo {
  return {
    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(periods)
        .where(and(eq(periods.userId, userId), eq(periods.id, id)))
        .limit(1);
      return row ?? null;
    },
    async findBySeq(userId, seq) {
      const [row] = await db
        .select()
        .from(periods)
        .where(and(eq(periods.userId, userId), eq(periods.seq, seq)))
        .limit(1);
      return row ?? null;
    },
    async findContaining(userId, date) {
      const [row] = await db
        .select()
        .from(periods)
        .where(and(eq(periods.userId, userId), lte(periods.startDate, date), gte(periods.endDate, date)))
        .limit(1);
      return row ?? null;
    },
    async findFirst(userId) {
      const [row] = await db
        .select()
        .from(periods)
        .where(eq(periods.userId, userId))
        .orderBy(asc(periods.seq))
        .limit(1);
      return row ?? null;
    },
    async findLast(userId) {
      const [row] = await db
        .select()
        .from(periods)
        .where(eq(periods.userId, userId))
        .orderBy(desc(periods.seq))
        .limit(1);
      return row ?? null;
    },
    async listFromSeq(userId, fromSeq) {
      return db
        .select()
        .from(periods)
        .where(and(eq(periods.userId, userId), gte(periods.seq, fromSeq)))
        .orderBy(asc(periods.seq));
    },
    async listAll(userId) {
      return db.select().from(periods).where(eq(periods.userId, userId)).orderBy(asc(periods.seq));
    },
    async create(period) {
      await db.insert(periods).values(period).catch(rethrowConstraint);
      return period;
    },
    async update(userId, id, patch, now) {
      await db
        .update(periods)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(periods.userId, userId), eq(periods.id, id)))
        .catch(rethrowConstraint);
    },
  };
}
