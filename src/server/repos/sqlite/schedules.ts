import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { budgetSchedules } from "../../db/schema.ts";
import type { ScheduleRepo } from "../types.ts";
import { rethrowConstraint } from "./errors.ts";

export function createScheduleRepo(db: Db): ScheduleRepo {
  return {
    async getForUser(userId) {
      const [row] = await db.select().from(budgetSchedules).where(eq(budgetSchedules.userId, userId)).limit(1);
      return row ?? null;
    },
    async create(schedule) {
      await db.insert(budgetSchedules).values(schedule).catch(rethrowConstraint);
      return schedule;
    },
  };
}
