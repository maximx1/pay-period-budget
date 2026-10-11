import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import type { DataStore, Repos } from "../types.ts";
import { createPeriodRepo } from "./periods.ts";
import { createRecurringRepo } from "./recurring.ts";
import { createScheduleRepo } from "./schedules.ts";
import { createSessionRepo } from "./sessions.ts";
import { createSettingsRepo } from "./settings.ts";
import { createTransactionRepo } from "./transactions.ts";
import { createUserRepo } from "./users.ts";

function createRepos(db: Db): Repos {
  return {
    users: createUserRepo(db),
    sessions: createSessionRepo(db),
    settings: createSettingsRepo(db),
    schedules: createScheduleRepo(db),
    periods: createPeriodRepo(db),
    transactions: createTransactionRepo(db),
    recurring: createRecurringRepo(db),
  };
}

type Run = <T>(operation: () => Promise<T>) => Promise<T>;

/** Runs operations one at a time, in the order they were submitted. */
function createQueue(): Run {
  let tail: Promise<unknown> = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
}

/** Routes every method call on every repo through `run`. */
function wrapRepos(repos: Repos, run: Run): Repos {
  const wrapped: Record<string, unknown> = {};
  for (const [name, repo] of Object.entries(repos)) {
    wrapped[name] = new Proxy(repo, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => run(() => value.apply(target, args));
      },
    });
  }
  return wrapped as unknown as Repos;
}

/**
 * The SQLite-backed store.
 *
 * All access is funnelled through one queue. SQLite allows a single writer, and this
 * driver waits for a busy database *synchronously*: a write attempted while a transaction
 * is open on another connection freezes the whole process for the busy timeout and then
 * fails. Queuing makes that impossible, and costs nothing real, because each query is a
 * blocking native call anyway; the only thing ever waited for is an in-flight transaction.
 */
export function createSqliteStore(db: Db): DataStore {
  const queue = createQueue();
  const insideTransaction = new AsyncLocalStorage<true>();

  const run: Run = (operation) => {
    if (insideTransaction.getStore()) {
      // It would queue behind the very transaction that is waiting for it: a deadlock.
      return Promise.reject(
        new Error("Inside store.transaction(), use the repos passed to the callback, not the store itself"),
      );
    }
    return queue(operation);
  };

  return {
    ...wrapRepos(createRepos(db), run),
    ping: () => run(async () => void (await db.run(sql`select 1`))),
    transaction: (fn) =>
      run(() =>
        // A drizzle transaction exposes the same query API as the database itself.
        db.transaction((tx) => insideTransaction.run(true, () => fn(createRepos(tx as unknown as Db)))),
      ),
  };
}
