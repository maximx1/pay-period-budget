import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.ts";

export type Db = LibSQLDatabase<typeof schema>;

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

/** Opens the SQLite database at `url` (a `file:` URL) and applies pending migrations. */
export async function openDatabase(url: string): Promise<{ db: Db; close: () => void }> {
  if (url.startsWith("file:")) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
