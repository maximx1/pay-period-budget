import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_TOKENS_OFF_MESSAGE, MAX_API_TOKENS } from "../../shared/auth.ts";
import { createApp } from "../app.ts";
import { hashToken } from "../lib/tokens.ts";
import { SESSION_COOKIE } from "../middleware/session.ts";
import { createTestApp, createTestClient, type TestApp } from "../testing.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const PASSWORD = "correct horse";
const IN_CURRENT_PERIOD = "2026-01-20T00:00";

let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: PASSWORD });
  const setup = await client.post("/api/budget", {
    type: "biweekly",
    anchorDate: "2025-12-16",
    openingCents: 100_000,
    timezone: "UTC",
  });
  expect(setup.status).toBe(201);
  return client;
}

async function createToken(client: Client, input: Record<string, unknown> = {}) {
  const response = await client.post("/api/auth/tokens", { name: "Assistant", scope: "write", ...input });
  expect(response.status).toBe(201);
  return (await response.json()) as { secret: string; token: { id: string; hint: string } };
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const iceCream = { name: "Ice cream", amountCents: 500, kind: "expense", occursAt: IN_CURRENT_PERIOD };

async function transactionCount(client: Client): Promise<number> {
  const view = await (await client.get("/api/periods/current")).json();
  return view.transactions.length;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("creating and listing API tokens", () => {
  it("hands over the secret once and stores only its hash", async () => {
    const { secret, token } = await createToken(ann, { name: "  Import helper ", scope: "read", expiresInDays: 30 });

    expect(secret).toMatch(/^ppb_[A-Za-z0-9_-]{43}$/);
    expect(token).toEqual({
      id: expect.any(String),
      name: "Import helper",
      scope: "read",
      hint: secret.slice(-4),
      createdAt: t.clock.now().toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(t.clock.now().getTime() + 30 * DAY).toISOString(),
    });

    expect(await t.store.apiTokens.findByTokenHash(secret)).toBeNull();
    expect(await t.store.apiTokens.findByTokenHash(hashToken(secret))).not.toBeNull();

    const listed = await ann.get("/api/auth/tokens");
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(body).not.toContain(secret);
    expect(JSON.parse(body).tokens).toEqual([token]);
  });

  it("lists the newest first and leaves expiry empty for a token that never expires", async () => {
    const first = await createToken(ann, { name: "First" });
    t.clock.advance(1000);
    const second = await createToken(ann, { name: "Second", expiresInDays: null });

    const { tokens } = await (await ann.get("/api/auth/tokens")).json();
    expect(tokens.map((token: { id: string }) => token.id)).toEqual([second.token.id, first.token.id]);
    expect(tokens[0].expiresAt).toBeNull();
    expect(tokens[1].expiresAt).toBeNull();
  });

  it("reports each invalid field", async () => {
    const response = await ann.post("/api/auth/tokens", { name: " ", scope: "admin", expiresInDays: 0 });
    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).error.fields).sort()).toEqual(["expiresInDays", "name", "scope"]);
  });

  it(`stops at ${MAX_API_TOKENS} tokens`, async () => {
    for (let i = 0; i < MAX_API_TOKENS; i += 1) await createToken(ann, { name: `Token ${i}` });

    const response = await ann.post("/api/auth/tokens", { name: "One too many", scope: "read" });
    expect(response.status).toBe(409);
    expect((await (await ann.get("/api/auth/tokens")).json()).tokens).toHaveLength(MAX_API_TOKENS);
  });

  it("needs a session", async () => {
    expect((await t.client().get("/api/auth/tokens")).status).toBe(401);
    expect((await t.client().post("/api/auth/tokens", { name: "x", scope: "read" })).status).toBe(401);
    expect((await t.client().delete("/api/auth/tokens/anything")).status).toBe(401);
  });
});

describe("using an API token", () => {
  it("reads and writes the budget with a write token", async () => {
    const { secret } = await createToken(ann);
    const agent = t.client();

    const me = await agent.get("/api/auth/me", bearer(secret));
    expect(me.status).toBe(200);
    expect((await me.json()).user.username).toBe("ann");
    expect(me.headers.get("set-cookie")).toBeNull();

    const created = await agent.post("/api/transactions", iceCream, bearer(secret));
    expect(created.status).toBe(201);
    const { transaction } = await created.json();

    const view = await agent.get("/api/periods/current", bearer(secret));
    expect(view.status).toBe(200);
    expect((await view.json()).transactions.map((row: { id: string }) => row.id)).toEqual([transaction.id]);

    const patched = await agent.patch(`/api/transactions/${transaction.id}`, { status: "paid" }, bearer(secret));
    expect(patched.status).toBe(200);
    expect((await agent.delete(`/api/transactions/${transaction.id}`, bearer(secret))).status).toBe(204);
    expect(await transactionCount(ann)).toBe(0);
  });

  it("lets a read token read and nothing else", async () => {
    const { transaction } = await (await ann.post("/api/transactions", iceCream)).json();
    const { secret } = await createToken(ann, { scope: "read" });
    const agent = t.client();

    expect((await agent.get("/api/periods/current", bearer(secret))).status).toBe(200);
    expect((await agent.get("/api/bills-income", bearer(secret))).status).toBe(200);
    expect((await agent.get("/api/budget", bearer(secret))).status).toBe(200);
    const listed = await agent.get("/api/transactions?from=2026-01-01&to=2026-01-31", bearer(secret));
    expect((await listed.json()).transactions).toEqual([expect.objectContaining({ id: transaction.id })]);

    const refused = [
      await agent.post("/api/transactions", iceCream, bearer(secret)),
      await agent.patch(`/api/transactions/${transaction.id}`, { name: "Changed" }, bearer(secret)),
      await agent.put("/api/transactions/order", { ids: [transaction.id] }, bearer(secret)),
      await agent.delete(`/api/transactions/${transaction.id}`, bearer(secret)),
      await agent.post("/api/periods/earlier", undefined, bearer(secret)),
      await agent.patch("/api/settings", { timezone: "America/New_York" }, bearer(secret)),
    ];
    for (const response of refused) {
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("forbidden");
    }

    const view = await (await ann.get("/api/periods/current")).json();
    expect(view.transactions).toEqual([expect.objectContaining({ id: transaction.id, name: "Ice cream" })]);
  });

  it("cannot manage the account, whatever its scope", async () => {
    const { secret, token } = await createToken(ann);
    const agent = t.client();
    const sessions = (await (await ann.get("/api/auth/sessions")).json()).sessions;

    const refused = [
      await agent.post("/api/auth/password", { currentPassword: PASSWORD, newPassword: "something new" }, bearer(secret)),
      await agent.get("/api/auth/sessions", bearer(secret)),
      await agent.post("/api/auth/sessions/revoke-others", undefined, bearer(secret)),
      await agent.delete(`/api/auth/sessions/${sessions[0].id}`, bearer(secret)),
      await agent.get("/api/auth/tokens", bearer(secret)),
      await agent.post("/api/auth/tokens", { name: "Another", scope: "write" }, bearer(secret)),
      await agent.delete(`/api/auth/tokens/${token.id}`, bearer(secret)),
    ];
    for (const response of refused) {
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("forbidden");
    }

    // Nothing happened: the password, the session and the token are all as they were.
    const login = await t.client().post("/api/auth/login", { identifier: "ann", password: PASSWORD });
    expect(login.status).toBe(200);
    expect((await ann.get("/api/auth/me")).status).toBe(200);
    expect((await (await ann.get("/api/auth/tokens")).json()).tokens).toHaveLength(1);
  });

  it("does not end the token when signing out with it", async () => {
    const { secret } = await createToken(ann);
    expect((await t.client().post("/api/auth/logout", undefined, bearer(secret))).status).toBe(204);
    expect((await t.client().get("/api/auth/me", bearer(secret))).status).toBe(200);
  });

  it("is refused once it has expired, and stays listed until revoked", async () => {
    const { secret, token } = await createToken(ann, { expiresInDays: 30 });
    const forever = await createToken(ann, { name: "Forever" });

    t.clock.advance(30 * DAY - 1000);
    expect((await t.client().get("/api/auth/me", bearer(secret))).status).toBe(200);

    t.clock.advance(1000);
    const expired = await t.client().get("/api/auth/me", bearer(secret));
    expect(expired.status).toBe(401);
    expect((await expired.json()).error.code).toBe("unauthenticated");

    t.clock.advance(400 * DAY);
    expect((await t.client().get("/api/auth/me", bearer(forever.secret))).status).toBe(200);

    // Ann's own session has lapsed by now; she signs in again to look.
    const again = t.client();
    await again.post("/api/auth/login", { identifier: "ann", password: PASSWORD });
    const { tokens } = await (await again.get("/api/auth/tokens")).json();
    expect(tokens.map((listed: { id: string }) => listed.id).sort()).toEqual([token.id, forever.token.id].sort());
  });

  it("is refused once revoked", async () => {
    const { secret, token } = await createToken(ann);
    expect((await ann.delete(`/api/auth/tokens/${token.id}`)).status).toBe(204);

    expect((await t.client().get("/api/auth/me", bearer(secret))).status).toBe(401);
    expect((await (await ann.get("/api/auth/tokens")).json()).tokens).toEqual([]);
    expect((await ann.delete(`/api/auth/tokens/${token.id}`)).status).toBe(404);
  });

  it("is refused when unknown, malformed, or sent as a cookie", async () => {
    const { secret } = await createToken(ann);

    expect((await t.client().get("/api/auth/me", bearer(`${secret}x`))).status).toBe(401);
    expect((await t.client().get("/api/auth/me", bearer("ppb_"))).status).toBe(401);
    expect((await t.client().get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${secret}` })).status).toBe(401);
  });

  it("records when it was last used, about once an hour", async () => {
    const { secret, token } = await createToken(ann);
    const lastUsed = async () => (await t.store.apiTokens.findByTokenHash(hashToken(secret)))?.lastUsedAt?.getTime();
    expect(await lastUsed()).toBeUndefined();

    t.clock.advance(5000);
    const firstUse = t.clock.now().getTime();
    await t.client().get("/api/auth/me", bearer(secret));
    expect(await lastUsed()).toBe(firstUse);

    t.clock.advance(HOUR);
    await t.client().get("/api/auth/me", bearer(secret));
    expect(await lastUsed()).toBe(firstUse);

    t.clock.advance(1000);
    await t.client().get("/api/auth/me", bearer(secret));
    expect(await lastUsed()).toBe(t.clock.now().getTime());

    const { tokens } = await (await ann.get("/api/auth/tokens")).json();
    expect(tokens).toEqual([expect.objectContaining({ id: token.id, lastUsedAt: t.clock.now().toISOString() })]);
  });
});

describe("API tokens and other people", () => {
  it("only ever reaches its own user's data", async () => {
    const bob = await signUp("bob");
    await ann.post("/api/transactions", iceCream);
    const { secret } = await createToken(bob);

    const view = await (await t.client().get("/api/periods/current", bearer(secret))).json();
    expect(view.transactions).toEqual([]);
    expect((await (await t.client().get("/api/auth/me", bearer(secret))).json()).user.username).toBe("bob");
  });

  it("cannot be listed or revoked by another user", async () => {
    const bob = await signUp("bob");
    const { secret, token } = await createToken(ann);

    expect((await (await bob.get("/api/auth/tokens")).json()).tokens).toEqual([]);
    const response = await bob.delete(`/api/auth/tokens/${token.id}`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");

    expect((await t.client().get("/api/auth/me", bearer(secret))).status).toBe(200);
  });

  it("counts the limit per user", async () => {
    const bob = await signUp("bob");
    for (let i = 0; i < MAX_API_TOKENS; i += 1) await createToken(ann, { name: `Token ${i}` });
    await createToken(bob);
  });
});

describe("changing the password", () => {
  it("revokes every API token and leaves other users' alone", async () => {
    const bob = await signUp("bob");
    const bobs = await createToken(bob);
    const first = await createToken(ann, { name: "First" });
    const second = await createToken(ann, { name: "Second", scope: "read" });

    const changed = await ann.post("/api/auth/password", { currentPassword: PASSWORD, newPassword: "a new password" });
    expect(changed.status).toBe(204);

    expect((await t.client().get("/api/auth/me", bearer(first.secret))).status).toBe(401);
    expect((await t.client().get("/api/auth/me", bearer(second.secret))).status).toBe(401);
    expect((await (await ann.get("/api/auth/tokens")).json()).tokens).toEqual([]);
    expect((await t.client().get("/api/auth/me", bearer(bobs.secret))).status).toBe(200);
  });

  it("keeps them when the current password was wrong", async () => {
    const { secret } = await createToken(ann);
    const refused = await ann.post("/api/auth/password", { currentPassword: "not it", newPassword: "a new password" });
    expect(refused.status).toBe(400);
    expect((await t.client().get("/api/auth/me", bearer(secret))).status).toBe(200);
  });
});

describe("API tokens turned off for the whole server (ALLOW_API_TOKENS=false)", () => {
  /** The same database and clock behind a server started with the setting one way or the other, signed in as ann. */
  const signedOut = (allowApiTokens: boolean): Client =>
    createTestClient(createApp({ store: t.store, config: { ...t.config, allowApiTokens }, now: t.clock.now }).app);
  function server(allowApiTokens: boolean): Client {
    const client = signedOut(allowApiTokens);
    client.sessionCookie = ann.sessionCookie;
    return client;
  }
  const refusal = { error: { code: "forbidden", message: API_TOKENS_OFF_MESSAGE } };

  it("is on unless the server says otherwise, and tells a client either way", async () => {
    expect(t.config.allowApiTokens).toBe(true);
    expect((await (await ann.get("/api/auth/config")).json()).apiTokensEnabled).toBe(true);
    expect((await (await server(false).get("/api/auth/config")).json()).apiTokensEnabled).toBe(false);
  });

  it("refuses every API token, for reading as well as writing, and says why", async () => {
    const write = await createToken(ann);
    const read = await createToken(ann, { name: "Reader", scope: "read" });
    const off = server(false);
    // No cookie: the token is all these requests carry.
    const anonymous = signedOut(false);

    for (const secret of [write.secret, read.secret]) {
      const reading = await anonymous.get("/api/periods/current", bearer(secret));
      expect(reading.status).toBe(403);
      expect(await reading.json()).toEqual(refusal);
      // The one account endpoint a token may normally use.
      const me = await anonymous.get("/api/auth/me", bearer(secret));
      expect(me.status).toBe(403);
      expect(await me.json()).toEqual(refusal);
    }

    const writing = await anonymous.post("/api/transactions", iceCream, bearer(write.secret));
    expect(writing.status).toBe(403);
    expect(await writing.json()).toEqual(refusal);
    expect(await transactionCount(off)).toBe(0);

    // A token that was never issued is told the same, so the answer says nothing about any one token.
    const unknown = await anonymous.get("/api/periods/current", bearer(`ppb_${"x".repeat(43)}`));
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual(refusal);
  });

  it("does not record a refused token as used", async () => {
    const { secret, token } = await createToken(ann);
    await server(false).get("/api/periods/current", bearer(secret));
    const listed = (await (await ann.get("/api/auth/tokens")).json()).tokens as Array<{ id: string; lastUsedAt: string | null }>;
    expect(listed.find((each) => each.id === token.id)?.lastUsedAt).toBeNull();
  });

  it("leaves signed-in sessions alone: the web app's cookie and the phone's bearer session", async () => {
    const off = server(false);
    expect((await off.get("/api/periods/current")).status).toBe(200);
    expect((await off.post("/api/transactions", iceCream)).status).toBe(201);

    const phone = signedOut(false);
    const signedIn = await phone.post("/api/auth/login", { identifier: "ann", password: PASSWORD, transport: "token" });
    expect(signedIn.status).toBe(200);
    const session = (await signedIn.json()).token as string;
    expect((await phone.get("/api/periods/current", bearer(session))).status).toBe(200);
    expect((await phone.get("/api/auth/sessions", bearer(session))).status).toBe(200);
  });

  it("makes no new tokens while off, but still lists and revokes the ones there are", async () => {
    const kept = await createToken(ann, { name: "Kept" });
    const dropped = await createToken(ann, { name: "Dropped" });
    const off = server(false);

    const made = await off.post("/api/auth/tokens", { name: "Another", scope: "read" });
    expect(made.status).toBe(403);
    expect(await made.json()).toEqual(refusal);

    const names = async () =>
      ((await (await off.get("/api/auth/tokens")).json()).tokens as Array<{ name: string }>).map((each) => each.name).sort();
    expect(await names()).toEqual(["Dropped", "Kept"]);
    expect((await off.delete(`/api/auth/tokens/${dropped.token.id}`)).status).toBe(204);
    expect(await names()).toEqual(["Kept"]);
    expect(kept.token.id).toEqual(expect.any(String));
  });

  it("keeps the tokens: one made before works again when it is turned back on", async () => {
    const { secret } = await createToken(ann);
    expect((await server(false).get("/api/periods/current", bearer(secret))).status).toBe(403);

    const backOn = signedOut(true);
    expect((await backOn.get("/api/periods/current", bearer(secret))).status).toBe(200);
    expect((await backOn.post("/api/transactions", iceCream, bearer(secret))).status).toBe(201);
  });
});
