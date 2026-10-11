// Creates the local development account. Never run against a real deployment.
import { randomUUID } from "node:crypto";
import { openDatabase } from "../db/client.ts";
import { loadConfig } from "../env.ts";
import { hashPassword } from "../lib/password.ts";
import { createSqliteStore } from "../repos/sqlite/index.ts";

const DEV_USER = { username: "sample", email: "sample@example.com", password: "abc123456" };

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const config = loadConfig();
if (config.isProduction) {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const { db, close } = await openDatabase(config.databaseUrl);
const store = createSqliteStore(db);

if (await store.users.findByEmail(DEV_USER.email)) {
  console.log(`${DEV_USER.email} already exists; nothing to do.`);
} else {
  await store.users.create({
    id: randomUUID(),
    username: DEV_USER.username,
    email: DEV_USER.email,
    passwordHash: await hashPassword(DEV_USER.password),
    now: new Date(),
  });
  console.log(`Created ${DEV_USER.email} (username "${DEV_USER.username}").`);
}
close();
