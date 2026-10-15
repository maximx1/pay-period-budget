import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/client.ts";
import { loadConfig } from "./env.ts";
import { createSqliteStore } from "./repos/sqlite/index.ts";

const STATIC_DIR = "./dist/client";
const HOUR = 60 * 60 * 1000;

try {
  process.loadEnvFile();
} catch {
  // No .env file; defaults and real environment variables apply.
}

const config = loadConfig();
const { db, close } = await openDatabase(config.databaseUrl);
const { app, auth, ocr } = createApp({
  store: createSqliteStore(db),
  config,
  staticDir: config.isProduction && existsSync(STATIC_DIR) ? STATIC_DIR : undefined,
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`);
});

const purge = () => auth.purgeExpiredSessions().catch(console.error);
purge();
setInterval(purge, HOUR).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close();
      void ocr.close().finally(() => process.exit(0));
    });
  });
}
