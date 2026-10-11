import { afterEach, describe, expect, it, vi } from "vitest";

// Stands in for the phone's storage; survives a module reload the way a restart would.
const device = new Map<string, string>();

/** Loads api.ts and sessionStore.ts fresh, as a browser or as the Android app. */
async function load(platform: "web" | "native") {
  vi.resetModules();
  vi.doMock("./platform.ts", () => ({ isNative: platform === "native" }));
  vi.doMock("@capacitor/preferences", () => ({
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: device.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => void device.set(key, value),
      remove: async ({ key }: { key: string }) => void device.delete(key),
    },
  }));
  vi.doMock("@capgo/capacitor-native-biometric", () => ({
    AccessControl: {},
    BiometricAuthError: {},
    NativeBiometric: { deleteData: async () => undefined },
  }));
  const store = await import("./sessionStore.ts");
  const { api, setUnauthenticatedHandler } = await import("./api.ts");
  return { api, setUnauthenticatedHandler, store };
}

function respondWith(...responses: Response[]) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = () => Response.json({ ok: true });
const refused = (code: string) => Response.json({ error: { code, message: "No" } }, { status: 401 });
const sent = (fetchMock: ReturnType<typeof respondWith>, call = 0) => {
  const init = fetchMock.mock.calls[call]![1];
  return { credentials: init.credentials, headers: init.headers as Record<string, string> };
};

afterEach(() => {
  device.clear();
  vi.unstubAllGlobals();
});

describe("in a browser", () => {
  it("sends the cookie and never a token", async () => {
    const { api, store } = await load("web");
    await store.setToken("ignored");
    await store.loadToken();
    const fetchMock = respondWith(ok(), ok());

    await api.get("/api/auth/me");
    await api.post("/api/transactions", { name: "Rent" });

    expect(store.getToken()).toBeNull();
    expect(device.size).toBe(0);
    expect(sent(fetchMock, 0)).toEqual({ credentials: "include", headers: {} });
    expect(sent(fetchMock, 1)).toEqual({
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });
});

describe("in the Android app", () => {
  it("sends the stored token in the Authorization header and no cookie", async () => {
    const { api, store } = await load("native");
    await store.setToken("abc");
    const fetchMock = respondWith(ok());

    await api.post("/api/transactions", { name: "Rent" });

    expect(sent(fetchMock)).toEqual({
      credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: "Bearer abc" },
    });
  });

  it("sends no Authorization header while signed out", async () => {
    const { api } = await load("native");
    const fetchMock = respondWith(ok());

    await api.get("/api/auth/config");

    expect(sent(fetchMock)).toEqual({ credentials: "omit", headers: {} });
  });

  it("has the token again after a restart once it has been loaded", async () => {
    const first = await load("native");
    await first.store.setToken("abc");

    const restarted = await load("native");
    expect(restarted.store.getToken()).toBeNull();
    await restarted.store.loadToken();
    expect(restarted.store.getToken()).toBe("abc");
  });

  it("forgets the token when the server says the session is gone", async () => {
    const { api, setUnauthenticatedHandler, store } = await load("native");
    await store.setToken("abc");
    const onUnauthenticated = vi.fn();
    setUnauthenticatedHandler(onUnauthenticated);
    respondWith(refused("unauthenticated"));

    await expect(api.get("/api/budget")).rejects.toMatchObject({ code: "unauthenticated" });

    expect(store.getToken()).toBeNull();
    expect(device.size).toBe(0);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("keeps the token when a 401 is about something else", async () => {
    const { api, store } = await load("native");
    await store.setToken("abc");
    respondWith(refused("invalid_credentials"));

    await expect(api.post("/api/auth/password", {})).rejects.toMatchObject({ status: 401 });

    expect(store.getToken()).toBe("abc");
  });

  it("keeps a newer token when a request sent with the old one is refused late", async () => {
    const { api, store } = await load("native");
    await store.setToken("old");
    let refuse!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (refuse = resolve)));

    const stale = api.get("/api/budget");
    await store.setToken("new");
    refuse(refused("unauthenticated"));
    await expect(stale).rejects.toMatchObject({ code: "unauthenticated" });

    expect(store.getToken()).toBe("new");
    expect(device.get("session.token")).toBe("new");
  });
});
