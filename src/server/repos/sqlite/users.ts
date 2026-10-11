import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import type { UserRepo } from "../types.ts";
import { rethrowConstraint } from "./errors.ts";

export function createUserRepo(db: Db): UserRepo {
  return {
    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },
    async findByUsername(username) {
      const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      return row ?? null;
    },
    async findByEmail(email) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ?? null;
    },
    async create({ now, ...user }) {
      const record = { ...user, createdAt: now, updatedAt: now };
      await db.insert(users).values(record).catch(rethrowConstraint);
      return record;
    },
  };
}
