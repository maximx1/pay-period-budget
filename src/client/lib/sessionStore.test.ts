import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone: plain preferences, and the biometric vault with its OS prompt.
const prefs = new Map<string, string>();
const vault = new Map<string, string>();
const phone = {
  /** A fingerprint the OS counts as strong is enrolled. */
  enrolled: true,
  /** What the next prompt does: pass, or fail with a plugin error code. */
  prompt: "pass" as "pass" | number,
  prompts: 0,
};

// The codes the store sorts on, as in the plugin's BiometricAuthError.
const CANCEL = 16;
const TEMPORARY_LOCKOUT = 4;
const NOT_ENROLLED = 3;
const UNKNOWN = 0;

/** Loads sessionStore.ts fresh, as after a restart; storage carries over. */
async function start(platform: "web" | "native" = "native") {
  vi.resetModules();
  vi.doMock("./platform.ts", () => ({ isNative: platform === "native" }));
  vi.doMock("@capacitor/preferences", () => ({
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
      remove: async ({ key }: { key: string }) => void prefs.delete(key),
    },
  }));
  vi.doMock("@capgo/capacitor-native-biometric", () => ({
    AccessControl: { BIOMETRY_ANY: 2 },
    BiometricAuthError: {
      BIOMETRICS_UNAVAILABLE: 1,
      USER_LOCKOUT: 2,
      BIOMETRICS_NOT_ENROLLED: NOT_ENROLLED,
      USER_TEMPORARY_LOCKOUT: TEMPORARY_LOCKOUT,
      PASSCODE_NOT_SET: 14,
      NO_PROTECTED_CREDENTIALS_FOUND: 21,
    },
    NativeBiometric: {
      isAvailable: async () => ({ strongBiometryIsAvailable: phone.enrolled }),
      isDataSaved: async ({ key }: { key: string }) => ({ isSaved: vault.has(key) }),
      setData: async ({ key, value, accessControl }: { key: string; value: string; accessControl: number }) => {
        if (accessControl !== 2) throw new Error("stored without biometric protection");
        if (!phone.enrolled) throw new Error("Failed to save data");
        vault.set(key, value);
      },
      getSecureData: async ({ key }: { key: string }) => {
        phone.prompts += 1;
        if (phone.prompt !== "pass") throw Object.assign(new Error("refused"), { code: String(phone.prompt) });
        const value = vault.get(key);
        if (value === undefined) throw Object.assign(new Error("No protected data found"), { code: "21" });
        return { value };
      },
      deleteData: async ({ key }: { key: string }) => void vault.delete(key),
    },
  }));
  const store = await import("./sessionStore.ts");
  await store.loadToken();
  return store;
}

/** A phone signed in with a password and biometric unlock switched on. */
async function withBiometricUnlock(token = "abc") {
  const store = await start();
  await store.setToken(token);
  expect(await store.setBiometricUnlock(true)).toBe(true);
  phone.prompts = 0;
  return store;
}

beforeEach(() => {
  prefs.clear();
  vault.clear();
  Object.assign(phone, { enrolled: true, prompt: "pass", prompts: 0 });
});

describe("in a browser", () => {
  it("stores nothing, is never locked and never offers biometric unlock", async () => {
    const store = await start("web");
    await store.setToken("abc");

    expect(store.getToken()).toBeNull();
    expect(await store.setBiometricUnlock(true)).toBe(true);
    expect(store.biometricUnlockEnabled()).toBe(false);
    expect(await store.biometricUnlockAvailable()).toBe(false);
    expect(await store.shouldOfferBiometricUnlock()).toBe(false);
    expect(await store.unlock()).toBe("unlocked");
    store.lock();
    expect(store.isLocked()).toBe(false);
    expect(prefs.size + vault.size).toBe(0);
  });
});

describe("without biometric unlock", () => {
  it("keeps the token in preferences and has it again after a restart, unlocked", async () => {
    await (await start()).setToken("abc");
    expect(prefs.get("session.token")).toBe("abc");
    expect(vault.size).toBe(0);

    const restarted = await start();
    expect(restarted.getToken()).toBe("abc");
    expect(restarted.isLocked()).toBe(false);
  });

  it("never locks for time away", async () => {
    const store = await start();
    await store.setToken("abc");
    store.noteAppHidden(0);
    store.noteAppShown(store.AWAY_LIMIT_MS * 10);
    expect(store.getToken()).toBe("abc");
    expect(store.isLocked()).toBe(false);
  });
});

describe("turning biometric unlock on", () => {
  it("moves the token out of preferences into the vault after one fingerprint check", async () => {
    const store = await start();
    await store.setToken("abc");

    expect(await store.setBiometricUnlock(true)).toBe(true);

    expect(phone.prompts).toBe(1);
    expect(prefs.has("session.token")).toBe(false);
    expect(vault.get("session.token")).toBe("abc");
    expect(store.biometricUnlockEnabled()).toBe(true);
    expect(store.getToken()).toBe("abc");
  });

  it("changes nothing when the fingerprint check is cancelled", async () => {
    const store = await start();
    await store.setToken("abc");
    phone.prompt = CANCEL;

    expect(await store.setBiometricUnlock(true)).toBe(false);

    expect(prefs.get("session.token")).toBe("abc");
    expect(vault.size).toBe(0);
    expect(store.biometricUnlockEnabled()).toBe(false);
    expect((await start()).getToken()).toBe("abc");
  });

  it("changes nothing when no fingerprint is enrolled", async () => {
    const store = await start();
    await store.setToken("abc");
    phone.enrolled = false;

    expect(await store.setBiometricUnlock(true)).toBe(false);
    expect(prefs.get("session.token")).toBe("abc");
  });
});

describe("with biometric unlock on", () => {
  it("starts locked with no token in memory, and a passed check loads it", async () => {
    await withBiometricUnlock();

    const store = await start();
    expect(store.isLocked()).toBe(true);
    expect(store.getToken()).toBeNull();
    expect(phone.prompts).toBe(0);

    expect(await store.unlock()).toBe("unlocked");
    expect(store.getToken()).toBe("abc");
    expect(store.isLocked()).toBe(false);
    expect(phone.prompts).toBe(1);
  });

  it.each([
    { what: "a cancelled prompt", code: CANCEL, result: "cancelled" },
    { what: "an unexplained failure", code: UNKNOWN, result: "cancelled" },
    { what: "too many failed tries", code: TEMPORARY_LOCKOUT, result: "locked-out" },
  ])("stays locked and keeps the token after $what", async ({ code, result }) => {
    await withBiometricUnlock();
    const store = await start();
    phone.prompt = code;

    expect(await store.unlock()).toBe(result);

    expect(store.isLocked()).toBe(true);
    expect(store.getToken()).toBeNull();
    expect(vault.get("session.token")).toBe("abc");

    phone.prompt = "pass";
    expect(await store.unlock()).toBe("unlocked");
  });

  it("falls back to the password when fingerprints were removed from the phone", async () => {
    await withBiometricUnlock();
    const store = await start();
    phone.prompt = NOT_ENROLLED;

    expect(await store.unlock()).toBe("gone");

    expect(store.isLocked()).toBe(false);
    expect(store.getToken()).toBeNull();
    expect(vault.size).toBe(0);
  });

  it("falls back to the password when the OS destroyed the key", async () => {
    await withBiometricUnlock();
    const store = await start();
    // What the plugin does on a permanently invalidated key: deletes the data, reports code 0.
    vault.clear();
    phone.prompt = UNKNOWN;

    expect(await store.unlock()).toBe("gone");
    expect(store.isLocked()).toBe(false);
  });

  it("tells subscribers when it locks and unlocks", async () => {
    const store = await withBiometricUnlock();
    const changes: boolean[] = [];
    const unsubscribe = store.subscribeToLock(() => changes.push(store.isLocked()));

    store.lock();
    await store.unlock();
    unsubscribe();
    store.lock();

    expect(changes).toEqual([true, false]);
  });

  it("locks after more than five minutes away, and not before", async () => {
    const store = await withBiometricUnlock();

    store.noteAppHidden(1_000);
    store.noteAppShown(1_000 + store.AWAY_LIMIT_MS);
    expect(store.isLocked()).toBe(false);

    store.noteAppHidden(1_000);
    store.noteAppShown(1_001 + store.AWAY_LIMIT_MS);
    expect(store.isLocked()).toBe(true);
    expect(store.getToken()).toBeNull();
  });

  it("puts the token from a new password sign-in straight into the vault", async () => {
    const store = await withBiometricUnlock("old");
    await store.clearToken();
    expect(vault.size).toBe(0);

    await store.setToken("new");

    expect(vault.get("session.token")).toBe("new");
    expect(prefs.has("session.token")).toBe(false);
    expect(phone.prompts).toBe(0);
    expect((await start()).isLocked()).toBe(true);
  });

  it("goes back to plain storage if the vault stops accepting a new token", async () => {
    const store = await withBiometricUnlock("old");
    await store.clearToken();
    phone.enrolled = false;

    await store.setToken("new");

    expect(prefs.get("session.token")).toBe("new");
    expect(store.biometricUnlockEnabled()).toBe(false);
    const restarted = await start();
    expect(restarted.isLocked()).toBe(false);
    expect(restarted.getToken()).toBe("new");
  });

  it("starts unlocked and signed out once the token has been cleared", async () => {
    const store = await withBiometricUnlock();
    await store.clearToken();

    const restarted = await start();
    expect(restarted.isLocked()).toBe(false);
    expect(restarted.getToken()).toBeNull();
    expect(restarted.biometricUnlockEnabled()).toBe(true);
  });

  it("moves the token back to preferences when turned off", async () => {
    const store = await withBiometricUnlock();

    expect(await store.setBiometricUnlock(false)).toBe(true);

    expect(prefs.get("session.token")).toBe("abc");
    expect(vault.size).toBe(0);
    const restarted = await start();
    expect(restarted.isLocked()).toBe(false);
    expect(restarted.getToken()).toBe("abc");
  });
});

describe("the one-time offer", () => {
  it("is made after a password sign-in on a phone with a fingerprint enrolled", async () => {
    const store = await start();
    expect(await store.shouldOfferBiometricUnlock()).toBe(false);
    await store.setToken("abc");
    expect(await store.shouldOfferBiometricUnlock()).toBe(true);
  });

  it("is not made without an enrolled fingerprint", async () => {
    phone.enrolled = false;
    const store = await start();
    await store.setToken("abc");
    expect(await store.shouldOfferBiometricUnlock()).toBe(false);
  });

  it("is not repeated once answered, whatever the answer", async () => {
    const store = await start();
    await store.setToken("abc");
    await store.markBiometricUnlockOffered();

    expect(await store.shouldOfferBiometricUnlock()).toBe(false);
    expect(await (await start()).shouldOfferBiometricUnlock()).toBe(false);
  });

  it("is not made when biometric unlock is already on", async () => {
    const store = await withBiometricUnlock();
    expect(await store.shouldOfferBiometricUnlock()).toBe(false);
  });
});
