import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import { addDays, dateOf } from "../../shared/dates.ts";
import type { TransactionResponse } from "../../shared/transactions.ts";
import type { PeriodRecord } from "../repos/types.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 30 days earlier, generated two
// periods past the current one, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
const OPENING = 100_000;
const IN_P1 = "2026-01-05T00:00";
const IN_P2 = "2026-01-20T00:00";
const IN_P3 = "2026-02-01T00:00";

let t: TestApp;
let ann: Client;
let annId: string;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string, opening = OPENING): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  const setup = await client.post("/api/budget", {
    type: "biweekly",
    anchorDate: "2025-12-16",
    openingCents: opening,
    timezone: "UTC",
  });
  expect(setup.status).toBe(201);
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  annId = (await t.store.users.findByUsername("ann"))!.id;
});
afterEach(() => t.cleanup());

const expense = (overrides: Record<string, unknown> = {}) => ({
  name: "Bag of ice",
  amountCents: 2700,
  kind: "expense",
  occursAt: IN_P2,
  ...overrides,
});

async function create(client: Client, body: Record<string, unknown>): Promise<TransactionResponse> {
  const response = await client.post("/api/transactions", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return response.json();
}

async function patch(client: Client, id: string, body: Record<string, unknown>): Promise<TransactionResponse> {
  const response = await client.patch(`/api/transactions/${id}`, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

const periods = () => t.store.periods.listFromSeq(annId, 0);
const startings = async () => (await periods()).map((p) => p.startingCents);
const viewOf = async (client: Client, period: PeriodRecord) =>
  (await (await client.get(`/api/periods/${period.id}`)).json()) as PeriodView;
const viewOfSeq = async (seq: number) => viewOf(ann, (await periods())[seq]!);

/** Every automatic starting amount must equal what the period before it is projected to end with. */
async function expectChainConsistent() {
  const all = await periods();
  for (let i = 1; i < all.length; i++) {
    if (all[i]!.startingMode === "manual") continue;
    const previous = all[i - 1]!;
    const sums = await t.store.transactions.sumInRange(annId, previous.startDate, previous.endDate);
    expect(all[i]!.startingCents, `starting amount of period ${i}`).toBe(
      previous.startingCents + sums.paidCents + sums.upcomingCents,
    );
  }
}

describe("creating a transaction", () => {
  it("adds an upcoming expense to its period and lowers every later starting amount", async () => {
    const { transaction, period } = await create(ann, expense());

    expect(transaction).toMatchObject({
      name: "Bag of ice",
      amountCents: -2700,
      kind: "expense",
      occursAt: IN_P2,
      status: "upcoming",
      paidAt: null,
      note: null,
    });
    expect(period).toEqual({ id: (await periods())[2]!.id, startDate: "2026-01-13", endDate: "2026-01-26" });

    const view = await viewOfSeq(2);
    expect(view.transactions.map((tx) => tx.id)).toEqual([transaction.id]);
    expect(view.totals).toEqual({
      paidCents: 0,
      upcomingCents: -2700,
      leftoverCents: OPENING,
      projectedCents: OPENING - 2700,
    });
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING - 2700, OPENING - 2700]);
  });

  it("raises later starting amounts for income", async () => {
    const { transaction } = await create(ann, expense({ name: "Paycheck", amountCents: 150_000, kind: "income" }));

    expect(transaction).toMatchObject({ amountCents: 150_000, kind: "income" });
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING + 150_000, OPENING + 150_000]);
  });

  it("can be created already paid", async () => {
    const { transaction } = await create(ann, expense({ paid: true }));

    expect(transaction.status).toBe("paid");
    expect(transaction.paidAt).toBe("2026-01-15T12:00:00.000Z");
    expect((await viewOfSeq(2)).totals).toEqual({
      paidCents: -2700,
      upcomingCents: 0,
      leftoverCents: OPENING - 2700,
      projectedCents: OPENING - 2700,
    });
  });

  it("keeps a note, trimmed, and treats a blank one as none", async () => {
    expect((await create(ann, expense({ note: "  from the gas station  " }))).transaction.note).toBe("from the gas station");
    expect((await create(ann, expense({ note: "   " }))).transaction.note).toBeNull();
  });

  it("generates the period for a future date that has none yet", async () => {
    const { transaction, period } = await create(ann, expense({ occursAt: "2026-06-01T09:30" }));

    expect(period.startDate <= "2026-06-01" && "2026-06-01" <= period.endDate).toBe(true);
    const all = await periods();
    expect(all.at(-1)!.id).toBe(period.id);
    expect((await viewOf(ann, all.at(-1)!)).transactions.map((tx) => tx.id)).toEqual([transaction.id]);
    await expectChainConsistent();
  });

  it("lists a period's transactions in date order", async () => {
    await create(ann, expense({ name: "third", occursAt: "2026-01-22T08:00" }));
    await create(ann, expense({ name: "first", occursAt: "2026-01-14T00:00" }));
    await create(ann, expense({ name: "second", occursAt: "2026-01-14T17:45" }));
    await create(ann, expense({ name: "elsewhere", occursAt: IN_P3 }));

    expect((await viewOfSeq(2)).transactions.map((tx) => tx.name)).toEqual(["first", "second", "third"]);
  });

  it.each([
    ["before the budget started", "2025-12-15T23:59"],
    ["more than a year ahead", "2027-03-15T00:00"],
  ])("refuses a date %s", async (_label, occursAt) => {
    const response = await ann.post("/api/transactions", expense({ occursAt }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("occursAt");
    expect((await periods()).length).toBe(5);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING, OPENING]);
  });

  it.each([
    ["a zero amount", { amountCents: 0 }, "amountCents"],
    ["a negative amount", { amountCents: -500 }, "amountCents"],
    ["a fractional amount", { amountCents: 10.5 }, "amountCents"],
    ["an oversized amount", { amountCents: 100_000_001 }, "amountCents"],
    ["an amount sent as text", { amountCents: "27.00" }, "amountCents"],
    ["an empty name", { name: "   " }, "name"],
    ["an overlong name", { name: "x".repeat(101) }, "name"],
    ["an unknown kind", { kind: "transfer" }, "kind"],
    ["a date with no time", { occursAt: "2026-01-20" }, "occursAt"],
    ["an impossible date", { occursAt: "2026-02-30T10:00" }, "occursAt"],
    ["an overlong note", { note: "x".repeat(501) }, "note"],
  ])("rejects %s", async (_label, overrides, field) => {
    const response = await ann.post("/api/transactions", expense(overrides));

    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty(field);
    expect((await viewOfSeq(2)).transactions).toEqual([]);
  });
});

describe("marking paid", () => {
  it("moves the amount from upcoming to paid without touching the projection or later periods", async () => {
    const { transaction } = await create(ann, expense());
    const before = await startings();

    const paid = (await patch(ann, transaction.id, { status: "paid" })).transaction;
    expect(paid).toMatchObject({ status: "paid", paidAt: "2026-01-15T12:00:00.000Z" });
    expect((await viewOfSeq(2)).totals).toEqual({
      paidCents: -2700,
      upcomingCents: 0,
      leftoverCents: OPENING - 2700,
      projectedCents: OPENING - 2700,
    });
    expect(await startings()).toEqual(before);

    const unpaid = (await patch(ann, transaction.id, { status: "upcoming" })).transaction;
    expect(unpaid).toMatchObject({ status: "upcoming", paidAt: null });
    expect((await viewOfSeq(2)).totals.leftoverCents).toBe(OPENING);
    expect(await startings()).toEqual(before);
  });

  it("keeps the original paid time when other fields change", async () => {
    const { transaction } = await create(ann, expense({ paid: true }));
    t.clock.advance(60_000);

    expect((await patch(ann, transaction.id, { name: "Ice", status: "paid" })).transaction.paidAt).toBe(transaction.paidAt);
  });
});

describe("editing a transaction", () => {
  it("shifts later starting amounts by the difference when the amount changes", async () => {
    const { transaction } = await create(ann, expense());
    const updated = (await patch(ann, transaction.id, { amountCents: 3000 })).transaction;

    expect(updated.amountCents).toBe(-3000);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING - 3000, OPENING - 3000]);
  });

  it("swings by twice the amount when an expense becomes income", async () => {
    const { transaction } = await create(ann, expense());
    const updated = (await patch(ann, transaction.id, { kind: "income" })).transaction;

    expect(updated).toMatchObject({ amountCents: 2700, kind: "income" });
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING + 2700, OPENING + 2700]);
  });

  it("leaves money alone when only the name or note changes", async () => {
    const { transaction } = await create(ann, expense({ note: "old" }));
    const before = await startings();

    const renamed = (await patch(ann, transaction.id, { name: "Ice, two bags" })).transaction;
    expect(renamed).toMatchObject({ name: "Ice, two bags", note: "old", amountCents: -2700 });
    expect((await patch(ann, transaction.id, { note: "" })).transaction.note).toBeNull();
    expect((await patch(ann, transaction.id, { note: "new" })).transaction.note).toBe("new");
    expect((await patch(ann, transaction.id, { note: null })).transaction.note).toBeNull();
    expect(await startings()).toEqual(before);
  });

  it("moves to the next period when its date does", async () => {
    const { transaction } = await create(ann, expense());
    const moved = await patch(ann, transaction.id, { occursAt: IN_P3 });

    expect(moved.period.startDate).toBe("2026-01-27");
    expect((await viewOfSeq(2)).transactions).toEqual([]);
    expect((await viewOfSeq(3)).transactions.map((tx) => tx.id)).toEqual([transaction.id]);
    // P3 no longer inherits the expense; P4 still does, now by way of P3.
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING, OPENING - 2700]);
  });

  it("moves to an earlier period when its date does", async () => {
    const { transaction } = await create(ann, expense());
    await patch(ann, transaction.id, { occursAt: IN_P1 });

    expect((await viewOfSeq(1)).transactions.map((tx) => tx.id)).toEqual([transaction.id]);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING - 2700, OPENING - 2700, OPENING - 2700]);
  });

  it("handles a new date and a new amount in one edit", async () => {
    const { transaction } = await create(ann, expense());
    await patch(ann, transaction.id, { occursAt: IN_P3, amountCents: 5000 });

    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING, OPENING - 5000]);
  });

  it("stays put when the time changes within the same period", async () => {
    const { transaction } = await create(ann, expense());
    const before = await startings();
    const moved = await patch(ann, transaction.id, { occursAt: "2026-01-26T23:59" });

    expect(moved.period.endDate).toBe("2026-01-26");
    expect(await startings()).toEqual(before);
  });

  it("generates a period when the new date has none yet", async () => {
    const { transaction } = await create(ann, expense());
    const moved = await patch(ann, transaction.id, { occursAt: "2026-05-05T00:00" });

    expect((await periods()).at(-1)!.id).toBe(moved.period.id);
    await expectChainConsistent();
  });

  it("refuses an out-of-range date and changes nothing", async () => {
    const { transaction } = await create(ann, expense());
    const before = await startings();

    const response = await ann.patch(`/api/transactions/${transaction.id}`, { occursAt: "2025-01-01T00:00", amountCents: 1 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("occursAt");
    expect((await viewOfSeq(2)).transactions[0]).toMatchObject({ occursAt: IN_P2, amountCents: -2700 });
    expect(await startings()).toEqual(before);
  });

  it("rejects an empty patch and invalid fields", async () => {
    const { transaction } = await create(ann, expense());

    expect((await ann.patch(`/api/transactions/${transaction.id}`, {})).status).toBe(400);
    expect((await ann.patch(`/api/transactions/${transaction.id}`, { amountCents: 0 })).status).toBe(400);
    expect((await ann.patch(`/api/transactions/${transaction.id}`, { status: "void" })).status).toBe(400);
  });
});

describe("deleting a transaction", () => {
  it("removes it and restores later starting amounts", async () => {
    const { transaction } = await create(ann, expense());

    expect((await ann.delete(`/api/transactions/${transaction.id}`)).status).toBe(204);
    expect((await viewOfSeq(2)).transactions).toEqual([]);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING, OPENING]);
    expect((await ann.delete(`/api/transactions/${transaction.id}`)).status).toBe(404);
  });
});

describe("carrying leftover forward", () => {
  it("stops at a period whose starting amount was set by hand", async () => {
    const [, , , p3] = await periods();
    await t.store.periods.update(annId, p3!.id, { startingCents: 5000, startingMode: "manual" }, t.clock.now());

    await create(ann, expense()); // in P2, before the pinned period
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, 5000, OPENING]);

    await create(ann, expense({ occursAt: IN_P3, amountCents: 1000 })); // in the pinned period itself
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, 5000, OPENING - 1000]);
  });

  it("uses the projected leftover when a new period is generated", async () => {
    await create(ann, expense({ occursAt: "2026-02-15T00:00", amountCents: 40_000 })); // in P4, the last one
    await create(ann, expense({ occursAt: "2026-02-16T00:00", amountCents: 10_000, kind: "income", paid: true }));

    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect((await periods()).at(-1)!.startingCents).toBe(OPENING - 40_000 + 10_000);
  });

  it("stays consistent through a long run of mixed changes", async () => {
    // Small deterministic generator so a failure can be reproduced exactly.
    let seed = 20261010;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const randomDateTime = () => `${addDays("2025-12-16", Math.floor(random() * 120))}T${pick(["00:00", "08:15", "23:59"])}`;
    const live: string[] = [];

    for (let step = 0; step < 40; step++) {
      const action = live.length < 3 ? "create" : pick(["create", "create", "amount", "move", "kind", "status", "delete"] as const);
      if (action === "create") {
        const { transaction } = await create(ann, {
          name: `tx ${step}`,
          amountCents: 1 + Math.floor(random() * 50_000),
          kind: pick(["expense", "expense", "income"]),
          occursAt: randomDateTime(),
          paid: random() < 0.3,
        });
        live.push(transaction.id);
        continue;
      }
      const id = pick(live);
      if (action === "delete") {
        expect((await ann.delete(`/api/transactions/${id}`)).status).toBe(204);
        live.splice(live.indexOf(id), 1);
      } else if (action === "amount") await patch(ann, id, { amountCents: 1 + Math.floor(random() * 50_000) });
      else if (action === "move") await patch(ann, id, { occursAt: randomDateTime() });
      else if (action === "kind") await patch(ann, id, { kind: pick(["expense", "income"]) });
      else await patch(ann, id, { status: pick(["paid", "upcoming"]) });

      await expectChainConsistent();
    }

    // Every surviving transaction is in exactly one period's view.
    const seen: string[] = [];
    for (const period of await periods()) {
      const view = await viewOf(ann, period);
      for (const tx of view.transactions) {
        expect(period.startDate <= dateOf(tx.occursAt) && dateOf(tx.occursAt) <= period.endDate).toBe(true);
        seen.push(tx.id);
      }
      expect(view.totals.projectedCents).toBe(
        period.startingCents + view.transactions.reduce((sum, tx) => sum + tx.amountCents, 0),
      );
    }
    expect(seen.sort()).toEqual([...live].sort());
  });
});

describe("manual order among transactions at the same date and time", () => {
  const names = async () => (await viewOfSeq(2)).transactions.map((tx) => tx.name);
  const add = async (name: string, overrides: Record<string, unknown> = {}) => (await create(ann, expense({ name, ...overrides }))).transaction;

  it("puts each new transaction after the ones already at that moment", async () => {
    await add("first");
    await add("second");
    await add("third");

    expect(await names()).toEqual(["first", "second", "third"]);
    expect((await viewOfSeq(2)).transactions.map((tx) => tx.sortOrder)).toEqual([0, 1, 2]);
  });

  it("saves a new order and returns it with the period", async () => {
    const [a, b, c] = [await add("a"), await add("b"), await add("c")];

    expect((await ann.put("/api/transactions/order", { ids: [c.id, a.id, b.id] })).status).toBe(204);
    expect(await names()).toEqual(["c", "a", "b"]);

    // A later arrival still goes to the end.
    await add("d");
    expect(await names()).toEqual(["c", "a", "b", "d"]);
  });

  it("never reorders across different times", async () => {
    const early = await add("early", { occursAt: "2026-01-20T08:00" });
    const late = await add("late", { occursAt: "2026-01-20T09:00" });

    const response = await ann.put("/api/transactions/order", { ids: [late.id, early.id] });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("ids");
    expect(await names()).toEqual(["early", "late"]);
  });

  it("joins the end of the queue when moved to another date and time", async () => {
    const [a, b] = [await add("a"), await add("b")];
    const mover = await add("mover", { occursAt: "2026-01-21T00:00" });
    await ann.put("/api/transactions/order", { ids: [b.id, a.id] });

    await patch(ann, mover.id, { occursAt: IN_P2 });
    expect(await names()).toEqual(["b", "a", "mover"]);

    // Editing something other than the time leaves its place alone.
    await patch(ann, b.id, { name: "b renamed", amountCents: 1 });
    expect(await names()).toEqual(["b renamed", "a", "mover"]);
  });

  it("keeps recurring bills that land on the same day in a stable, adjustable order", async () => {
    for (const name of ["Electric", "Internet", "Water"]) {
      const response = await ann.post("/api/recurring", {
        name,
        kind: "expense",
        defaultAmountCents: 1000,
        recurrenceUnit: "month",
        firstDueDate: "2026-01-20",
      });
      expect(response.status).toBe(201);
    }
    const rows = (await viewOfSeq(2)).transactions;
    expect(rows.map((tx) => tx.name)).toEqual(["Electric", "Internet", "Water"]);
    expect(rows.map((tx) => tx.sortOrder)).toEqual([0, 1, 2]);

    await ann.put("/api/transactions/order", { ids: [rows[2]!.id, rows[0]!.id, rows[1]!.id] });
    expect(await names()).toEqual(["Water", "Electric", "Internet"]);
  });

  it.each([
    ["no ids", { ids: [] }],
    ["a repeated id", { ids: ["x", "x"] }],
    ["an unknown id", { ids: ["nope"] }],
    ["a missing list", {}],
  ])("rejects %s", async (_label, body) => {
    expect((await ann.put("/api/transactions/order", body)).status).toBe(400);
  });

  it("requires a session and refuses another user's transactions", async () => {
    const [a, b] = [await add("a"), await add("b")];
    expect((await t.client().put("/api/transactions/order", { ids: [b.id, a.id] })).status).toBe(401);

    const bob = await signUp("bob", 0);
    expect((await bob.put("/api/transactions/order", { ids: [b.id, a.id] })).status).toBe(400);
    expect(await names()).toEqual(["a", "b"]);
  });
});

describe("access control", () => {
  it("requires a session", async () => {
    const anonymous = t.client();
    expect((await anonymous.post("/api/transactions", expense())).status).toBe(401);
    expect((await anonymous.patch("/api/transactions/x", { name: "y" })).status).toBe(401);
    expect((await anonymous.delete("/api/transactions/x")).status).toBe(401);
  });

  it("keeps one user's transactions out of another's reach", async () => {
    const { transaction } = await create(ann, expense());
    const bob = await signUp("bob", 0);
    const bobId = (await t.store.users.findByUsername("bob"))!.id;

    expect((await bob.patch(`/api/transactions/${transaction.id}`, { amountCents: 1 })).status).toBe(404);
    expect((await bob.delete(`/api/transactions/${transaction.id}`)).status).toBe(404);

    const bobCurrent = (await (await bob.get("/api/periods/current")).json()) as PeriodView;
    expect(bobCurrent.transactions).toEqual([]);
    expect(bobCurrent.totals.projectedCents).toBe(0);
    expect((await t.store.periods.listFromSeq(bobId, 0)).every((p) => p.startingCents === 0)).toBe(true);

    // And Ann's is untouched.
    expect((await viewOfSeq(2)).transactions[0]).toMatchObject({ id: transaction.id, amountCents: -2700 });
  });
});
