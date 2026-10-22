import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { userSettings } from "../../db/schema.ts";
import type { SettingsRepo } from "../types.ts";

export function createSettingsRepo(db: Db): SettingsRepo {
  return {
    async get(userId) {
      const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
      return row ?? null;
    },
    async upsert(userId, values, now) {
      await db
        .insert(userSettings)
        .values({ userId, ...values, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: now } });
    },
    async setAdvicePersona(userId, { persona, custom }, now) {
      const changed = await db
        .update(userSettings)
        .set({ advicePersona: persona, advicePersonaCustom: custom, updatedAt: now })
        .where(eq(userSettings.userId, userId))
        .returning({ userId: userSettings.userId });
      return changed.length > 0;
    },
    async setBalanceChecks(userId, values, now) {
      const changed = await db
        .update(userSettings)
        .set({ ...values, updatedAt: now })
        .where(eq(userSettings.userId, userId))
        .returning({ userId: userSettings.userId });
      return changed.length > 0;
    },
    async setLowBalance(userId, values, now) {
      const changed = await db
        .update(userSettings)
        .set({ ...values, updatedAt: now })
        .where(eq(userSettings.userId, userId))
        .returning({ userId: userSettings.userId });
      return changed.length > 0;
    },
  };
}
