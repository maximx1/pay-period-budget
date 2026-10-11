import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = new Map<string, string>();

/** Loads serverUrl.ts fresh, as after a restart; the phone's storage carries over. */
async function start(platform: "web" | "native", builtIn?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (builtIn !== undefined) vi.stubEnv("VITE_API_BASE_URL", builtIn);
  vi.doMock("./platform.ts", () => ({ isNative: platform === "native" }));
  vi.doMock("@capacitor/preferences", () => ({
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
      remove: async ({ key }: { key: string }) => void prefs.delete(key),
    },
  }));
  const server = await import("./serverUrl.ts");
  await server.loadServerUrl();
  return server;
}

beforeEach(() => prefs.clear());

describe("parseServerUrl", () => {
  it.each([
    ["https://budget.mysite.com/", "https://budget.mysite.com"],
    ["https://budget.mysite.com", "https://budget.mysite.com"],
    ["  budget.mysite.com  ", "https://budget.mysite.com"],
    ["budget.mysite.com/login?next=1", "https://budget.mysite.com"],
    ["HTTPS://Budget.MySite.com/", "https://budget.mysite.com"],
    ["https://budget.mysite.com:8443/app", "https://budget.mysite.com:8443"],
    ["http://10.0.2.2:8787", "http://10.0.2.2:8787"],
    ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
    ["http://localhost:8787", "http://localhost:8787"],
  ])("%s → %s", async (typed, url) => {
    const { parseServerUrl } = await start("native");
    expect(parseServerUrl(typed)).toEqual({ url });
  });

  it.each([
    ["", "Enter your server's address"],
    ["   ", "Enter your server's address"],
    ["http://budget.mysite.com", "The address must start with https://"],
    ["http://192.168.1.20:8787", "The address must start with https://"],
    ["ftp://budget.mysite.com", "The address must start with https://"],
    ["https://me:secret@budget.mysite.com", "Leave the username and password out of the address"],
    ["https://", "That doesn't look like a web address"],
    ["budget mysite com", "That doesn't look like a web address"],
  ])("%j is refused: %s", async (typed, error) => {
    const { parseServerUrl } = await start("native");
    expect(parseServerUrl(typed)).toEqual({ error });
  });
});

describe("in a browser", () => {
  it("always has a server: the one the page came from", async () => {
    const server = await start("web");
    expect(server.hasServerUrl()).toBe(true);
    expect(server.getServerUrl()).toBe("");

    await server.setServerUrl("https://elsewhere.example.com");
    await server.forgetServerUrl();
    expect(server.getServerUrl()).toBe("");
    expect(server.hasServerUrl()).toBe(true);
    expect(prefs.size).toBe(0);
  });
});

describe("in the Android app", () => {
  it("has no server until one is set, then remembers it across restarts", async () => {
    const first = await start("native");
    expect(first.hasServerUrl()).toBe(false);
    expect(first.getServerUrl()).toBe("");

    await first.setServerUrl("https://budget.mysite.com");
    expect(first.hasServerUrl()).toBe(true);
    expect(first.getServerUrl()).toBe("https://budget.mysite.com");

    const restarted = await start("native");
    expect(restarted.getServerUrl()).toBe("https://budget.mysite.com");
  });

  it("starts from the address built in, and prefers one the user set", async () => {
    const fresh = await start("native", "http://127.0.0.1:8787");
    expect(fresh.getServerUrl()).toBe("http://127.0.0.1:8787");

    await fresh.setServerUrl("https://budget.mysite.com");
    expect((await start("native", "http://127.0.0.1:8787")).getServerUrl()).toBe("https://budget.mysite.com");
  });

  it("asks again after the server is forgotten, offering the old address to edit", async () => {
    const server = await start("native");
    await server.setServerUrl("https://budget.mysite.com");
    const changes: boolean[] = [];
    server.subscribeToServerUrl(() => changes.push(server.hasServerUrl()));

    await server.forgetServerUrl();

    expect(changes).toEqual([false]);
    expect(server.previousServerUrl()).toBe("https://budget.mysite.com");
    expect((await start("native")).hasServerUrl()).toBe(false);
  });
});
