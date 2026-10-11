// Writes a consistent copy of the database to the given path, safely while the server is
// running:  npm run db:backup -- /path/to/copy.db
import { existsSync } from "node:fs";
import { createClient } from "@libsql/client";
import { loadConfig } from "../env.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run db:backup -- <path for the copy>");
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`${target} already exists; choose a new file name.`);
  process.exit(1);
}

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const client = createClient({ url: loadConfig().databaseUrl });
// VACUUM INTO takes a snapshot in one transaction, so the copy is never half-written.
await client.execute({ sql: "VACUUM INTO ?", args: [target] });
client.close();
console.log(`Backed up to ${target}`);
