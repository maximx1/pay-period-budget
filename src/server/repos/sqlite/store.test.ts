import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../../testing.ts";
import { UniqueConstraintError } from "../types.ts";

const now = new Date("2026-01-15T12:00:00Z");
const user = (n: number) => ({ id: `user-${n}`, username: `user${n}`, email: `user${n}@example.com`, passwordHash: "x", now });

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.cleanup());

describe("sqlite store", () => {
  it("names the field on a unique violation", async () => {
    await t.store.users.create(user(1));
    await expect(t.store.users.create({ ...user(2), username: "user1" })).rejects.toEqual(
      new UniqueConstraintError("username"),
    );
    await expect(t.store.users.create({ ...user(2), email: "user1@example.com" })).rejects.toEqual(
      new UniqueConstraintError("email"),
    );
  });

  it("rolls a transaction back when it throws", async () => {
    await expect(
      t.store.transaction(async (repos) => {
        await repos.users.create(user(1));
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await t.store.users.findById("user-1")).toBeNull();
  });

  it("commits a transaction that completes", async () => {
    await t.store.transaction(async (repos) => {
      await repos.users.create(user(1));
      await repos.users.create(user(2));
    });
    expect(await t.store.users.findById("user-2")).not.toBeNull();
  });

  it("lets concurrent transactions and writes all succeed without blocking each other", async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    const started = Date.now();

    await Promise.all([
      ...[1, 2, 3, 4, 5].map((n) =>
        t.store.transaction(async (repos) => {
          await repos.users.create(user(n));
          await pause(); // hold the transaction open across a tick while the others queue up
          await repos.users.findById(`user-${n}`);
        }),
      ),
      ...[6, 7, 8].map((n) => t.store.users.create(user(n))),
    ]);

    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(await t.store.users.findById(`user-${n}`)).not.toBeNull();
    // A busy wait in this driver blocks for seconds; staying well under that proves none happened.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses store access from inside a transaction instead of deadlocking", async () => {
    await expect(t.store.transaction(() => t.store.users.findById("user-1"))).rejects.toThrow(/repos passed/);
    await expect(t.store.transaction(() => t.store.transaction(async () => {}))).rejects.toThrow(/repos passed/);
    // The store is still usable afterwards.
    await t.store.users.create(user(1));
    expect(await t.store.users.findById("user-1")).not.toBeNull();
  });

  it("enforces foreign keys, inside and outside transactions", async () => {
    const orphan = { id: "s1", tokenHash: "h1", userId: "missing", createdAt: now, expiresAt: now, lastSeenAt: now, idleTimeoutMs: null, userAgent: null };
    await expect(t.store.sessions.create(orphan)).rejects.toThrow();
    await expect(t.store.transaction((repos) => repos.sessions.create({ ...orphan, id: "s2", tokenHash: "h2" }))).rejects.toThrow();
  });
});
