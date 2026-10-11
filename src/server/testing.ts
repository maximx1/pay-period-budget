// Test support: a real app over a throwaway SQLite file, a controllable clock,
// and a minimal cookie-keeping HTTP client.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/client.ts";
import { loadConfig } from "./env.ts";
import type { AppEnv } from "./http.ts";
import { SESSION_COOKIE } from "./middleware/session.ts";
import { createSqliteStore } from "./repos/sqlite/index.ts";

export async function createTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "ppb-test-"));
  const { db, close } = await openDatabase(`file:${join(dir, "test.db")}`);
  const store = createSqliteStore(db);
  const config = loadConfig({ NODE_ENV: "test" });

  let current = new Date("2026-01-15T12:00:00Z");
  const clock = {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };

  const { app, auth } = createApp({ store, config, now: clock.now });

  return {
    app,
    auth,
    store,
    config,
    clock,
    client: () => createTestClient(app),
    cleanup() {
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export function createTestClient(app: Hono<AppEnv>) {
  let sessionCookie: string | undefined;

  async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await app.request(path, {
      method,
      headers: {
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(sessionCookie && { cookie: `${SESSION_COOKIE}=${sessionCookie}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(header);
      if (match) sessionCookie = match[1] || undefined;
    }
    return response;
  }

  return {
    get: (path: string) => send("GET", path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => send("POST", path, body, headers),
    patch: (path: string, body?: unknown) => send("PATCH", path, body),
    delete: (path: string) => send("DELETE", path),
    get sessionCookie() {
      return sessionCookie;
    },
    set sessionCookie(value: string | undefined) {
      sessionCookie = value;
    },
  };
}
