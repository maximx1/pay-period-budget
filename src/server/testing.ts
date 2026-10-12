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

/**
 * @param env extra environment settings for the app's configuration, e.g. `{ ALLOW_REGISTRATION: "false" }`.
 *   The idle timeout is off unless a test turns it on (`{ IDLE_TIMEOUT_MINUTES: "10" }`): most tests
 *   move the clock by days and are not about a browser being left alone.
 */
export async function createTestApp(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ppb-test-"));
  const { db, close } = await openDatabase(`file:${join(dir, "test.db")}`);
  const store = createSqliteStore(db);
  const config = loadConfig({ NODE_ENV: "test", IDLE_TIMEOUT_MINUTES: "0", ...env });

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
    get: (path: string, headers?: Record<string, string>) => send("GET", path, undefined, headers),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => send("POST", path, body, headers),
    patch: (path: string, body?: unknown, headers?: Record<string, string>) => send("PATCH", path, body, headers),
    put: (path: string, body?: unknown, headers?: Record<string, string>) => send("PUT", path, body, headers),
    delete: (path: string, headers?: Record<string, string>) => send("DELETE", path, undefined, headers),
    get sessionCookie() {
      return sessionCookie;
    },
    set sessionCookie(value: string | undefined) {
      sessionCookie = value;
    },
  };
}
