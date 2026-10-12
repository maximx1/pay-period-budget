import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { apiTokens } from "../../db/schema.ts";
import type { ApiTokenRepo } from "../types.ts";

export function createApiTokenRepo(db: Db): ApiTokenRepo {
  return {
    async create(token) {
      await db.insert(apiTokens).values(token);
      return token;
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);
      return row ?? null;
    },
    async findById(userId, id) {
      const [row] = await db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, id)))
        .limit(1);
      return row ?? null;
    },
    async listForUser(userId) {
      return db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.createdAt));
    },
    async touch(id, lastUsedAt) {
      await db.update(apiTokens).set({ lastUsedAt }).where(eq(apiTokens.id, id));
    },
    async delete(userId, id) {
      await db.delete(apiTokens).where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, id)));
    },
    async deleteAllForUser(userId) {
      await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
    },
  };
}
