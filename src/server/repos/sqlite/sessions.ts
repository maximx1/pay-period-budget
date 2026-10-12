import { and, desc, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { sessions } from "../../db/schema.ts";
import type { SessionRepo } from "../types.ts";

export function createSessionRepo(db: Db): SessionRepo {
  return {
    async create(session) {
      await db.insert(sessions).values(session);
      return session;
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
      return row ?? null;
    },
    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.id, id)))
        .limit(1);
      return row ?? null;
    },
    async listForUser(userId) {
      return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastSeenAt));
    },
    async deleteOthers(userId, keepId) {
      await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)));
    },
    async touch(id, update) {
      await db.update(sessions).set(update).where(eq(sessions.id, id));
    },
    async deleteById(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
    async deleteAllForUser(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },
    async deleteExpired(now) {
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
    },
    async deleteIdle(now, graceMs) {
      await db
        .delete(sessions)
        .where(
          and(
            isNotNull(sessions.idleTimeoutMs),
            sql`${sessions.lastSeenAt} + ${sessions.idleTimeoutMs} + ${graceMs} < ${now.getTime()}`,
          ),
        );
    },
  };
}
