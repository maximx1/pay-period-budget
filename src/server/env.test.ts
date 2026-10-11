import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.ts";

describe("loadConfig", () => {
  it("ignores PORT in development, where tooling sets it for the web dev server", () => {
    expect(loadConfig({ PORT: "5173" }).port).toBe(8787);
    expect(loadConfig({ PORT: "5173", API_PORT: "9000" }).port).toBe(9000);
  });

  it("honours PORT in production", () => {
    expect(loadConfig({ NODE_ENV: "production", PORT: "3000" }).port).toBe(3000);
  });

  it("makes the session cookie HTTPS-only in production unless overridden", () => {
    expect(loadConfig({}).cookieSecure).toBe(false);
    expect(loadConfig({ NODE_ENV: "production" }).cookieSecure).toBe(true);
    expect(loadConfig({ NODE_ENV: "production", COOKIE_SECURE: "false" }).cookieSecure).toBe(false);
  });
});
