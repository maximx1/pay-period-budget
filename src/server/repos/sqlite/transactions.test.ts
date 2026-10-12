import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../../testing.ts";
import type { TransactionRecord } from "../types.ts";

const now = new Date("2026-01-15T12:00:00Z");

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  for (const id of ["ann", "bob"]) {
    await t.store.users.create({ id, username: id, email: `${id}@example.com`, passwordHash: "x", now });
  }
});
afterEach(() => t.cleanup());

let counter = 0;
const tx = (overrides: Partial<TransactionRecord>): TransactionRecord => ({
  id: `tx-${++counter}`,
  userId: "ann",
  name: "Thing",
  amountCents: -1000,
  occursAt: "2026-01-10T00:00",
  status: "upcoming",
  paidAt: null,
  sortOrder: 0,
  note: null,
  recurringId: null,
  occurrenceDate: null,
  importKey: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const ids = (rows: TransactionRecord[]) => rows.map((row) => row.id);

describe("transaction repo", () => {
  it("includes the whole first and last day of a range and nothing outside it", async () => {
    await t.store.transactions.create(tx({ id: "before", occursAt: "2026-01-01T23:59" }));
    await t.store.transactions.create(tx({ id: "first-minute", occursAt: "2026-01-02T00:00" }));
    await t.store.transactions.create(tx({ id: "last-minute", occursAt: "2026-01-15T23:59" }));
    await t.store.transactions.create(tx({ id: "after", occursAt: "2026-01-16T00:00" }));

    expect(ids(await t.store.transactions.listInRange("ann", "2026-01-02", "2026-01-15"))).toEqual([
      "first-minute",
      "last-minute",
    ]);
    expect(ids(await t.store.transactions.listInRange("ann", "2026-01-16", "2026-01-16"))).toEqual(["after"]);
  });

  it("orders by date-time, then manual order, then creation time", async () => {
    const earlier = new Date(now.getTime() - 1000);
    await t.store.transactions.create(tx({ id: "c", occursAt: "2026-01-05T00:00", sortOrder: 1 }));
    await t.store.transactions.create(tx({ id: "b2", occursAt: "2026-01-05T00:00", sortOrder: 0, createdAt: now }));
    await t.store.transactions.create(tx({ id: "b1", occursAt: "2026-01-05T00:00", sortOrder: 0, createdAt: earlier }));
    await t.store.transactions.create(tx({ id: "d", occursAt: "2026-01-05T09:30" }));
    await t.store.transactions.create(tx({ id: "a", occursAt: "2026-01-04T18:00", sortOrder: 9 }));

    expect(ids(await t.store.transactions.listInRange("ann", "2026-01-01", "2026-01-31"))).toEqual([
      "a",
      "b1",
      "b2",
      "c",
      "d",
    ]);
  });

  it("sums paid and upcoming separately, within the range only", async () => {
    await t.store.transactions.create(tx({ amountCents: -2500 }));
    await t.store.transactions.create(tx({ amountCents: -1000 }));
    await t.store.transactions.create(tx({ amountCents: 150000, status: "paid", paidAt: now }));
    await t.store.transactions.create(tx({ amountCents: -4000, status: "paid", paidAt: now }));
    await t.store.transactions.create(tx({ amountCents: -99999, occursAt: "2026-02-01T00:00" }));

    expect(await t.store.transactions.sumInRange("ann", "2026-01-01", "2026-01-31")).toEqual({
      paidCents: 146000,
      upcomingCents: -3500,
    });
    expect(await t.store.transactions.sumInRange("ann", "2025-01-01", "2025-12-31")).toEqual({
      paidCents: 0,
      upcomingCents: 0,
    });
  });

  it("updates the given fields only", async () => {
    await t.store.transactions.create(tx({ id: "one", note: "keep" }));
    const later = new Date("2026-01-16T00:00:00Z");
    await t.store.transactions.update("ann", "one", { status: "paid", paidAt: later }, later);

    expect(await t.store.transactions.findById("ann", "one")).toMatchObject({
      status: "paid",
      paidAt: later,
      note: "keep",
      amountCents: -1000,
      updatedAt: later,
    });
  });

  it("keeps one user's transactions out of another's reach", async () => {
    await t.store.transactions.create(tx({ id: "anns" }));

    expect(await t.store.transactions.findById("bob", "anns")).toBeNull();
    expect(await t.store.transactions.listInRange("bob", "2026-01-01", "2026-01-31")).toEqual([]);
    expect(await t.store.transactions.sumInRange("bob", "2026-01-01", "2026-01-31")).toEqual({ paidCents: 0, upcomingCents: 0 });

    await t.store.transactions.update("bob", "anns", { name: "hijacked" }, now);
    await t.store.transactions.delete("bob", "anns");
    expect((await t.store.transactions.findById("ann", "anns"))?.name).toBe("Thing");
  });
});
