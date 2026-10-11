import type { Db } from "../../db/client.ts";
import type { DataStore, Repos } from "../types.ts";
import { createSessionRepo } from "./sessions.ts";
import { createUserRepo } from "./users.ts";

function createRepos(db: Db): Repos {
  return {
    users: createUserRepo(db),
    sessions: createSessionRepo(db),
  };
}

export function createSqliteStore(db: Db): DataStore {
  return {
    ...createRepos(db),
    // A drizzle transaction exposes the same query API as the database itself.
    transaction: (fn) => db.transaction((tx) => fn(createRepos(tx as unknown as Db))),
  };
}
