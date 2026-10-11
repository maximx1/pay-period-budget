import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToken } from "../lib/tokens.ts";
import { createTestApp, type TestApp } from "../testing.ts";

const DAY = 24 * 60 * 60 * 1000;
const alice = { username: "alice", email: "alice@example.com", password: "correct horse" };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.cleanup());

describe("POST /api/auth/register", () => {
  it("creates the account, signs the user in and stores only a password hash", async () => {
    const client = t.client();
    const response = await client.post("/api/auth/register", alice);

    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toEqual({ id: expect.any(String), username: "alice", email: "alice@example.com" });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(user.id);

    const stored = await t.store.users.findByUsername("alice");
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(alice.password);
  });

  it("stores the session token hashed, never raw", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);
    const token = client.sessionCookie!;

    expect(await t.store.sessions.findByTokenHash(token)).toBeNull();
    expect(await t.store.sessions.findByTokenHash(hashToken(token))).not.toBeNull();
  });

  it("normalises username and email to lowercase", async () => {
    const response = await t.client().post("/api/auth/register", {
      ...alice,
      username: "  Alice ",
      email: "Alice@Example.COM",
    });
    expect((await response.json()).user).toMatchObject({ username: "alice", email: "alice@example.com" });
  });

  it("reports each invalid field", async () => {
    const response = await t.client().post("/api/auth/register", {
      username: "a b",
      email: "nope",
      password: "short",
    });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe("validation");
    expect(Object.keys(error.fields).sort()).toEqual(["email", "password", "username"]);
  });

  it("rejects a taken username or email, case-insensitively", async () => {
    await t.client().post("/api/auth/register", alice);

    const sameName = await t.client().post("/api/auth/register", { ...alice, username: "ALICE", email: "other@example.com" });
    expect(sameName.status).toBe(409);
    expect((await sameName.json()).error.fields).toHaveProperty("username");

    const sameEmail = await t.client().post("/api/auth/register", { ...alice, username: "alice2" });
    expect(sameEmail.status).toBe(409);
    expect((await sameEmail.json()).error.fields).toHaveProperty("email");
  });

  it("rejects bodies that are not JSON", async () => {
    const response = await t.app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(alice),
    });
    expect(response.status).toBe(415);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await t.client().post("/api/auth/register", alice);
  });

  it("accepts the username or the email", async () => {
    for (const identifier of ["alice", "Alice@Example.com"]) {
      const client = t.client();
      const response = await client.post("/api/auth/login", { identifier, password: alice.password });
      expect(response.status).toBe(200);
      expect((await client.get("/api/auth/me")).status).toBe(200);
    }
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const wrongPassword = await t.client().post("/api/auth/login", { identifier: "alice", password: "wrong password" });
    const unknownUser = await t.client().post("/api/auth/login", { identifier: "nobody", password: "wrong password" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  it("locks an account out after repeated failures, then lets it back in", async () => {
    const client = t.client();
    for (let i = 0; i < 10; i++) {
      await client.post("/api/auth/login", { identifier: "alice", password: "wrong password" });
    }

    const blocked = await client.post("/api/auth/login", { identifier: "alice", password: alice.password });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    t.clock.advance(16 * 60 * 1000);
    const allowed = await client.post("/api/auth/login", { identifier: "alice", password: alice.password });
    expect(allowed.status).toBe(200);
  });
});

describe("sessions", () => {
  it("requires a session for /me", async () => {
    const response = await t.client().get("/api/auth/me");
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });

  it("logout revokes the session server-side", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);
    const token = client.sessionCookie;

    expect((await client.post("/api/auth/logout")).status).toBe(204);
    expect(client.sessionCookie).toBeUndefined();

    // Replaying the old cookie must not work.
    client.sessionCookie = token;
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("expires after the TTL when unused", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);

    t.clock.advance(31 * DAY);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("slides the expiry forward while in use", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);

    t.clock.advance(20 * DAY);
    const renewed = await client.get("/api/auth/me");
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get("set-cookie")).toContain("ppb_session=");

    // 40 days after sign-in: past the original expiry, inside the renewed one.
    t.clock.advance(20 * DAY);
    expect((await client.get("/api/auth/me")).status).toBe(200);
  });

  it("deletes a user's sessions with the user's row", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);
    const user = (await t.store.users.findByUsername("alice"))!;

    await t.store.sessions.deleteAllForUser(user.id);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });
});

describe("changing the password", () => {
  const next = "a better passphrase";

  it("requires the current password", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);

    const response = await client.post("/api/auth/password", { currentPassword: "not it", newPassword: next });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("currentPassword");
    expect((await t.client().post("/api/auth/login", { identifier: "alice", password: alice.password })).status).toBe(200);
  });

  it("applies the password rules to the new one", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);

    const response = await client.post("/api/auth/password", { currentPassword: alice.password, newPassword: "short" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("newPassword");
  });

  it("replaces the password and signs out every other session, keeping this one", async () => {
    const here = t.client();
    await here.post("/api/auth/register", alice);
    const elsewhere = t.client();
    await elsewhere.post("/api/auth/login", { identifier: "alice", password: alice.password });

    const response = await here.post("/api/auth/password", { currentPassword: alice.password, newPassword: next });
    expect(response.status).toBe(204);

    expect((await here.get("/api/auth/me")).status).toBe(200);
    expect((await elsewhere.get("/api/auth/me")).status).toBe(401);
    expect((await t.client().post("/api/auth/login", { identifier: "alice", password: alice.password })).status).toBe(401);
    expect((await t.client().post("/api/auth/login", { identifier: "alice", password: next })).status).toBe(200);
    expect((await t.store.users.findByUsername("alice"))?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("limits guesses at the current password", async () => {
    const client = t.client();
    await client.post("/api/auth/register", alice);
    for (let i = 0; i < 10; i++) {
      await client.post("/api/auth/password", { currentPassword: "guess", newPassword: next });
    }

    const blocked = await client.post("/api/auth/password", { currentPassword: alice.password, newPassword: next });
    expect(blocked.status).toBe(429);

    t.clock.advance(16 * 60 * 1000);
    expect((await client.post("/api/auth/password", { currentPassword: alice.password, newPassword: next })).status).toBe(204);
  });

  it("requires a session", async () => {
    const response = await t.client().post("/api/auth/password", { currentPassword: alice.password, newPassword: next });
    expect(response.status).toBe(401);
  });
});

describe("signed-in devices", () => {
  const bob = { username: "bob", email: "bob@example.com", password: "another secret" };
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const pixel = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  type Listed = { id: string; device: string; current: boolean; createdAt: string; lastSeenAt: string };
  const list = async (client: ReturnType<TestApp["client"]>) => (await (await client.get("/api/auth/sessions")).json()).sessions as Listed[];

  async function twoDevices() {
    const laptop = t.client();
    await laptop.post("/api/auth/register", alice, { "user-agent": chrome });
    t.clock.advance(60_000);
    const phone = t.client();
    await phone.post("/api/auth/login", { identifier: "alice", password: alice.password }, { "user-agent": pixel });
    return { laptop, phone };
  }

  it("lists the account's sessions, newest activity first, marking the current one", async () => {
    const { laptop, phone } = await twoDevices();

    expect((await list(laptop)).map((s) => [s.device, s.current])).toEqual([
      ["Chrome on Android", false],
      ["Chrome on Mac", true],
    ]);
    expect((await list(phone)).map((s) => [s.device, s.current])).toEqual([
      ["Chrome on Android", true],
      ["Chrome on Mac", false],
    ]);
    expect((await list(laptop))[1]).toMatchObject({ createdAt: "2026-01-15T12:00:00.000Z", lastSeenAt: "2026-01-15T12:00:00.000Z" });
  });

  it("never shows another user's sessions, or expired ones", async () => {
    const { laptop } = await twoDevices();
    const other = t.client();
    await other.post("/api/auth/register", bob);

    expect((await list(other)).length).toBe(1);
    expect((await list(laptop)).length).toBe(2);

    // The phone goes unused for a month while the laptop stays active.
    for (let day = 0; day < 31; day += 10) {
      t.clock.advance(10 * 24 * 60 * 60 * 1000);
      await laptop.get("/api/auth/me");
    }
    expect((await list(laptop)).map((s) => s.device)).toEqual(["Chrome on Mac"]);
  });

  it("signs one other device out", async () => {
    const { laptop, phone } = await twoDevices();
    const phoneSession = (await list(laptop)).find((s) => !s.current)!;

    expect((await laptop.delete(`/api/auth/sessions/${phoneSession.id}`)).status).toBe(204);
    expect((await phone.get("/api/auth/me")).status).toBe(401);
    expect((await laptop.get("/api/auth/me")).status).toBe(200);
    expect((await laptop.delete(`/api/auth/sessions/${phoneSession.id}`)).status).toBe(404);
  });

  it("signs out everywhere else at once", async () => {
    const { laptop, phone } = await twoDevices();
    const tablet = t.client();
    await tablet.post("/api/auth/login", { identifier: "alice", password: alice.password });

    expect((await laptop.post("/api/auth/sessions/revoke-others")).status).toBe(204);
    expect((await phone.get("/api/auth/me")).status).toBe(401);
    expect((await tablet.get("/api/auth/me")).status).toBe(401);
    expect((await list(laptop)).length).toBe(1);
  });

  it("clears the cookie when the current session is the one signed out", async () => {
    const { laptop } = await twoDevices();
    const own = (await list(laptop)).find((s) => s.current)!;

    const response = await laptop.delete(`/api/auth/sessions/${own.id}`);
    expect(response.status).toBe(204);
    expect(laptop.sessionCookie).toBeUndefined();
  });

  it("refuses to touch another user's session", async () => {
    const { laptop } = await twoDevices();
    const aliceSession = (await list(laptop))[0]!;
    const other = t.client();
    await other.post("/api/auth/register", bob);

    expect((await other.delete(`/api/auth/sessions/${aliceSession.id}`)).status).toBe(404);
    await other.post("/api/auth/sessions/revoke-others");
    expect((await list(laptop)).length).toBe(2);
  });

  it("requires a session", async () => {
    const anonymous = t.client();
    expect((await anonymous.get("/api/auth/sessions")).status).toBe(401);
    expect((await anonymous.delete("/api/auth/sessions/x")).status).toBe(401);
    expect((await anonymous.post("/api/auth/sessions/revoke-others")).status).toBe(401);
  });
});

describe("token sessions (for clients on another origin, such as the phone app)", () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function tokenLogin() {
    await t.client().post("/api/auth/register", alice);
    const response = await t.client().post("/api/auth/login", { identifier: "alice", password: alice.password, transport: "token" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    return (await response.json()) as { user: { username: string }; token: string; expiresAt: string };
  }

  it("returns the token in the body instead of setting a cookie", async () => {
    const session = await tokenLogin();

    expect(session.user.username).toBe("alice");
    expect(session.token.length).toBeGreaterThan(30);
    expect(session.expiresAt).toBe("2026-02-14T12:00:00.000Z");
    expect(await t.store.sessions.findByTokenHash(hashToken(session.token))).not.toBeNull();
  });

  it("works for registration too", async () => {
    const response = await t.client().post("/api/auth/register", { ...alice, transport: "token" });
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).token).toEqual(expect.any(String));
  });

  it("authenticates requests that send the token in the Authorization header", async () => {
    const { token } = await tokenLogin();
    const client = t.client();

    expect((await client.get("/api/auth/me", bearer(token))).status).toBe(200);
    expect((await client.get("/api/auth/me")).status).toBe(401);
    expect((await client.get("/api/auth/me", { cookie: `some_other_cookie=${token}` })).status).toBe(401);
    expect((await client.get("/api/auth/me", bearer("not-a-real-token"))).status).toBe(401);
    expect((await client.get("/api/auth/me", { authorization: token })).status).toBe(401);
  });

  it("does not try to clear a cookie when a header token is rejected", async () => {
    const response = await t.client().get("/api/auth/me", bearer("not-a-real-token"));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("prefers the header when a request carries both a header and a cookie", async () => {
    const { token } = await tokenLogin();
    const bobInBrowser = t.client();
    await bobInBrowser.post("/api/auth/register", { username: "bob", email: "bob@example.com", password: "another secret" });

    const response = await bobInBrowser.get("/api/auth/me", bearer(token));
    expect((await response.json()).user.username).toBe("alice");
  });

  it("falls back to the cookie when the Authorization header is something else", async () => {
    const browser = t.client();
    await browser.post("/api/auth/register", alice);
    expect((await browser.get("/api/auth/me", { authorization: "Basic abc123" })).status).toBe(200);
  });

  it("revokes the session on logout", async () => {
    const { token } = await tokenLogin();
    const client = t.client();

    expect((await client.post("/api/auth/logout", undefined, bearer(token))).status).toBe(204);
    expect((await client.get("/api/auth/me", bearer(token))).status).toBe(401);
  });

  it("reports a renewed expiry in a header rather than a cookie", async () => {
    const { token } = await tokenLogin();
    const client = t.client();

    const fresh = await client.get("/api/auth/me", bearer(token));
    expect(fresh.headers.get("x-session-expires")).toBeNull();

    t.clock.advance(20 * DAY);
    const renewed = await client.get("/api/auth/me", bearer(token));
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get("x-session-expires")).toBe("2026-03-06T12:00:00.000Z");
    expect(renewed.headers.get("set-cookie")).toBeNull();

    t.clock.advance(20 * DAY);
    expect((await client.get("/api/auth/me", bearer(token))).status).toBe(200);
  });

  it("can use every other endpoint with the token", async () => {
    const { token } = await tokenLogin();
    const client = t.client();

    const setup = await client.post(
      "/api/budget",
      { type: "biweekly", anchorDate: "2026-01-10", timezone: "UTC" },
      bearer(token),
    );
    expect(setup.status).toBe(201);
    expect((await client.get("/api/periods/current", bearer(token))).status).toBe(200);
    expect((await client.get("/api/auth/sessions", bearer(token))).status).toBe(200);
  });

  it("rejects an unknown transport", async () => {
    await t.client().post("/api/auth/register", alice);
    const response = await t.client().post("/api/auth/login", { identifier: "alice", password: alice.password, transport: "carrier-pigeon" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("transport");
  });
});

describe("cross-origin access", () => {
  const allowed = "http://localhost:5173"; // the default APP_ORIGINS
  const preflight = (origin: string) =>
    t.app.request("/api/auth/login", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });

  it("answers a preflight from a listed origin", async () => {
    const response = await preflight(allowed);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(allowed);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
  });

  it("gives an unlisted origin no permission", async () => {
    const response = await preflight("https://evil.example");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets a listed origin read responses and the session-expiry header", async () => {
    const response = await t.client().get("/api/health", { origin: allowed });

    expect(response.headers.get("access-control-allow-origin")).toBe(allowed);
    expect(response.headers.get("access-control-expose-headers")).toContain("X-Session-Expires");
  });

  it("adds nothing for same-origin and non-browser requests", async () => {
    const response = await t.client().get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("closing registration", () => {
  let closed: TestApp;
  beforeEach(async () => {
    closed = await createTestApp({ ALLOW_REGISTRATION: "false" });
    await closed.auth.register(alice);
  });
  afterEach(() => closed.cleanup());

  it("tells the sign-in screen whether accounts can be created", async () => {
    expect(await (await t.client().get("/api/auth/config")).json()).toEqual({ registrationOpen: true });
    expect(await (await closed.client().get("/api/auth/config")).json()).toEqual({ registrationOpen: false });
  });

  it("refuses new accounts but still signs existing ones in", async () => {
    const attempt = await closed.client().post("/api/auth/register", {
      username: "mallory",
      email: "mallory@example.com",
      password: "let me in please",
    });
    expect(attempt.status).toBe(403);
    expect(await closed.store.users.findByUsername("mallory")).toBeNull();

    const login = await closed.client().post("/api/auth/login", { identifier: "alice", password: alice.password });
    expect(login.status).toBe(200);
  });
});

describe("health check", () => {
  it("reports healthy while the database answers", async () => {
    const response = await t.client().get("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("reports unhealthy when it does not", async () => {
    const broken = await createTestApp();
    broken.store.ping = () => Promise.reject(new Error("database is gone"));
    // The failure is logged by the error handler; keep the test output clean.
    const original = console.error;
    console.error = () => {};
    try {
      const response = await broken.client().get("/api/health");
      expect(response.status).toBe(500);
    } finally {
      console.error = original;
      broken.cleanup();
    }
  });
});

describe("request guards", () => {
  it("blocks state-changing requests from other origins", async () => {
    const response = await t.client().post("/api/auth/register", alice, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await t.store.users.findByUsername("alice")).toBeNull();
  });

  it("allows the configured app origin", async () => {
    const response = await t.client().post("/api/auth/register", alice, { origin: "http://localhost:5173" });
    expect(response.status).toBe(201);
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const response = await t.client().get("/api/nope");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });
});
