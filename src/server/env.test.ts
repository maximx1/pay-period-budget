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

  it("sets the idle timeout to ten minutes unless told otherwise, and lets it be turned off", () => {
    expect(loadConfig({}).idleTimeoutMs).toBe(10 * 60 * 1000);
    expect(loadConfig({ IDLE_TIMEOUT_MINUTES: "30" }).idleTimeoutMs).toBe(30 * 60 * 1000);
    expect(loadConfig({ IDLE_TIMEOUT_MINUTES: "0" }).idleTimeoutMs).toBe(0);
    expect(() => loadConfig({ IDLE_TIMEOUT_MINUTES: "-5" })).toThrow();
    expect(() => loadConfig({ IDLE_TIMEOUT_MINUTES: "soon" })).toThrow();
  });

  it("allows API tokens, and with them an assistant, unless told not to", () => {
    expect(loadConfig({}).allowApiTokens).toBe(true);
    expect(loadConfig({ ALLOW_API_TOKENS: "true" }).allowApiTokens).toBe(true);
    expect(loadConfig({ ALLOW_API_TOKENS: "false" }).allowApiTokens).toBe(false);
    expect(() => loadConfig({ ALLOW_API_TOKENS: "off" })).toThrow();
  });

  it("uses a screenshot-reading model only with an address and a model, and not while turned off", () => {
    const model = { SCAN_MODEL_URL: "http://localhost:11434/v1/", SCAN_MODEL: "reader-7b" };
    expect(loadConfig({}).scanModel).toBeNull();
    expect(loadConfig({ SCAN_MODEL_URL: model.SCAN_MODEL_URL }).scanModel).toBeNull();
    expect(loadConfig(model).scanModel).toEqual({
      url: "http://localhost:11434/v1",
      model: "reader-7b",
      apiKey: null,
      images: false,
      timeoutMs: 90_000,
    });
    expect(loadConfig({ ...model, SCAN_MODEL_KEY: "k", SCAN_MODEL_IMAGES: "true", SCAN_MODEL_TIMEOUT_SECONDS: "30" }).scanModel).toMatchObject({
      apiKey: "k",
      images: true,
      timeoutMs: 30_000,
    });
    // Turned off, its settings stay where they are.
    expect(loadConfig({ ...model, SCAN_MODEL_ENABLED: "false" }).scanModel).toBeNull();
    // What Docker Compose passes for settings left out of .env.
    expect(loadConfig({ SCAN_MODEL_URL: "", SCAN_MODEL: "", SCAN_MODEL_KEY: "" }).scanModel).toBeNull();
    expect(() => loadConfig({ SCAN_MODEL_URL: "not a url" })).toThrow();
  });

  it("asks a model for advice only when turned on, taking the scan model's settings for any of its own left out", () => {
    const scan = { SCAN_MODEL_URL: "http://localhost:11434/v1/", SCAN_MODEL: "reader-7b", SCAN_MODEL_KEY: "k" };
    expect(loadConfig(scan).adviceModel).toBeNull();
    expect(loadConfig({ ADVICE_ENABLED: "true" }).adviceModel).toBeNull();
    expect(loadConfig({ ...scan, ADVICE_ENABLED: "true" }).adviceModel).toEqual({
      url: "http://localhost:11434/v1",
      model: "reader-7b",
      apiKey: "k",
      timeoutMs: 180_000,
    });
    // Its own settings win, and the scan model can be off while advice is on, or the reverse.
    const own = { ADVICE_MODEL_URL: "https://api.example.com/v1", ADVICE_MODEL: "big", ADVICE_MODEL_KEY: "a", ADVICE_MODEL_TIMEOUT_SECONDS: "20" };
    const both = loadConfig({ ...scan, ...own, ADVICE_ENABLED: "true", SCAN_MODEL_ENABLED: "false" });
    expect(both.adviceModel).toEqual({ url: "https://api.example.com/v1", model: "big", apiKey: "a", timeoutMs: 20_000 });
    expect(both.scanModel).toBeNull();
    expect(loadConfig({ ...scan, ...own }).scanModel).not.toBeNull();
    expect(loadConfig({ ADVICE_ENABLED: "true", ADVICE_MODEL_URL: "", ADVICE_MODEL: "" }).adviceModel).toBeNull();
  });

  it("asks the advice model not to think first only when told to", () => {
    const on = { ADVICE_ENABLED: "true", ADVICE_MODEL_URL: "http://localhost:8080/v1", ADVICE_MODEL: "qwen" };
    expect(loadConfig(on).adviceModel).not.toHaveProperty("thinking");
    expect(loadConfig({ ...on, ADVICE_MODEL_THINKING: "false" }).adviceModel).toMatchObject({ thinking: false });
    expect(() => loadConfig({ ...on, ADVICE_MODEL_THINKING: "no" })).toThrow();
  });
});
