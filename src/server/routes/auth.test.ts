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
