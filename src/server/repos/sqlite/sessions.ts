import { eq, lte } from "drizzle-orm";
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
  };
}
