import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { loadConfig } from "./env.ts";
import { createTestApp, type TestApp } from "./testing.ts";

// Serving the built client: what production does when the API is the only server.
let t: TestApp;
let staticDir: string;
let app: ReturnType<typeof createApp>["app"];

beforeEach(async () => {
  t = await createTestApp();
  // Inside the project, because the static file server resolves its root from the working directory.
  mkdirSync("node_modules/.cache", { recursive: true });
  staticDir = mkdtempSync(join("node_modules/.cache", "ppb-static-"));
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>app shell</title>");
  writeFileSync(join(staticDir, "assets", "index-abc123.js"), "console.log('app')");

  app = createApp({
    store: t.store,
    config: loadConfig({ NODE_ENV: "production" }),
    staticDir: relative(process.cwd(), staticDir),
  }).app;
});
afterEach(() => {
  rmSync(staticDir, { recursive: true, force: true });
  t.cleanup();
});

describe("serving the client", () => {
  it("serves the app shell for the root and for any client-side route, never cached", async () => {
    for (const path of ["/", "/recurring", "/periods/some-id", "/settings"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain("app shell");
      expect(response.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  it("serves hashed assets as immutable", async () => {
    const response = await app.request("/assets/index-abc123.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("still answers unknown API paths with JSON, not the app shell", async () => {
    const response = await app.request("/api/nope");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("sends security headers with the page", async () => {
    const response = await app.request("/");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
