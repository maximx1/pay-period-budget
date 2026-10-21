import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { TransactionSplitResponse } from "../../shared/split.ts";
import type { Transaction } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16 gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23        P5 2026-02-24..03-09
//   P6 2026-03-10..03-23   ...                         P11 2026-05-19..06-01
const OPENING = 100_000;

let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Body = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  const setup = await client.post("/api/budget", {
    type: "biweekly",
    anchorDate: "2025-12-16",
    openingCents: OPENING,
    timezone: "UTC",
  });
  expect(setup.status).toBe(201);
  return client;
}

const item = (amountCents: number, dueDate: string, label = "") => ({ label, amountCents, dueDate });

const body = (overrides: Body = {}): Body => ({
  name: "PayPal",
  kind: "expense",
  occursAt: "2026-01-15T09:00",
  items: [item(100_000, "2026-03-05")],
  ...overrides,
});

async function split(client: Client, overrides: Body = {}) {
  const response = await client.post("/api/transactions/split", body(overrides));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as TransactionSplitResponse;
}

async function refused(client: Client, overrides: Body) {
  const response = await client.post("/api/transactions/split", body(overrides));
  expect(response.status).toBe(400);
  return ((await response.json()) as { error: { message: string; fields?: Record<string, string> } }).error;
}

const listed = async (client: Client, from = "2026-01-01", to = "2026-12-31") =>
  ((await (await client.get(`/api/transactions?from=${from}&to=${to}`)).json()) as { transactions: Transaction[] })
    .transactions;

const current = async (client: Client) => (await (await client.get("/api/periods/current")).json()) as PeriodView;

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});

afterEach(() => t.cleanup());

describe("splitting one amount", () => {
  it("spreads it evenly from the first payment's period through the one it is due in", async () => {
    const result = await split(ann);

    expect(result.dryRun).toBe(false);
    expect(result.payments.map(({ occursAt, amountCents, period }) => [occursAt, amountCents, period.startDate])).toEqual([
      ["2026-01-15T09:00", -25_000, "2026-01-13"],
      ["2026-01-27T00:00", -25_000, "2026-01-27"],
      ["2026-02-10T00:00", -25_000, "2026-02-10"],
      // Due 03-05: its last share is in the period holding that day, dated before it.
      ["2026-02-24T00:00", -25_000, "2026-02-24"],
    ]);

    const saved = await listed(ann);
    expect(saved.map(({ name, amountCents, occursAt, status, note, billIncomeId, categoryId }) => ({
      name,
      amountCents,
      occursAt,
      status,
      note,
      billIncomeId,
      categoryId,
    }))).toEqual(
      result.payments.map(({ occursAt, amountCents }) => ({
        name: "PayPal",
        amountCents,
        occursAt,
        status: "upcoming",
        note: null,
        billIncomeId: null,
        categoryId: null,
      })),
    );
  });

  it("gives the extra cents to the earliest payments", async () => {
    const result = await split(ann, { items: [item(43_267, "2026-03-05")] });
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([-10_817, -10_817, -10_817, -10_816]);
  });

  it("finishes a period early when asked", async () => {
    const result = await split(ann, { finishEarly: true });
    expect(result.payments.map(({ amountCents, period }) => [period.startDate, amountCents])).toEqual([
      ["2026-01-13", -33_334],
      ["2026-01-27", -33_333],
      ["2026-02-10", -33_333],
    ]);
  });

  it("is one payment when it is due in the first payment's own period", async () => {
    const result = await split(ann, { items: [item(5_000, "2026-01-20")] });
    expect(result.payments.map((payment) => [payment.occursAt, payment.amountCents])).toEqual([["2026-01-15T09:00", -5_000]]);
  });

  it("can be income", async () => {
    const result = await split(ann, { kind: "income", items: [item(1_000, "2026-01-27")] });
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([500, 500]);
  });

  it("starts where the first payment says, in a later period too", async () => {
    const result = await split(ann, { occursAt: "2026-02-10T00:00", items: [item(1_000, "2026-03-05")] });
    expect(result.payments.map((payment) => payment.occursAt)).toEqual(["2026-02-10T00:00", "2026-02-24T00:00"]);
  });

  it("carries the payments forward like any others", async () => {
    await split(ann);
    expect((await current(ann)).totals.projectedCents).toBe(OPENING - 25_000);
    const located = (await (await ann.post("/api/periods/locate", { date: "2026-03-10" })).json()) as { periodId: string };
    const after = (await (await ann.get(`/api/periods/${located.periodId}`)).json()) as PeriodView;
    expect(after.period.startingCents).toBe(OPENING - 100_000);
  });

  it("makes the pay periods it needs", async () => {
    const result = await split(ann, { items: [item(1_000, "2026-06-01")] });
    expect(result.payments.at(-1)!.period).toEqual({ startDate: "2026-05-19", endDate: "2026-06-01" });
  });
});

describe("splitting several amounts", () => {
  const several = {
    note: "Pay in 4",
    items: [item(100_000, "2026-03-05", "Laptop"), item(301, "2026-01-30", "Cable")],
  };

  it("makes one payment per period holding every item's share, and says what each makes up", async () => {
    const result = await split(ann, several);
    expect(result.payments.map(({ amountCents, shares }) => [amountCents, shares])).toEqual([
      [-25_151, [{ item: 0, cents: 25_000 }, { item: 1, cents: 151 }]],
      [-25_150, [{ item: 0, cents: 25_000 }, { item: 1, cents: 150 }]],
      [-25_000, [{ item: 0, cents: 25_000 }]],
      [-25_000, [{ item: 0, cents: 25_000 }]],
    ]);
    expect((await listed(ann)).map((transaction) => transaction.note)).toEqual([
      "Pay in 4 · Laptop $250.00 + Cable $1.51",
      "Pay in 4 · Laptop $250.00 + Cable $1.50",
      "Pay in 4 · Laptop $250.00",
      "Pay in 4 · Laptop $250.00",
    ]);
  });

  it("can tie every payment to a bill or income and file it under a category", async () => {
    const bill = (await (
      await ann.post("/api/bills-income", {
        name: "PayPal",
        kind: "expense",
        defaultAmountCents: 0,
        recurrenceUnit: "none",
        recurrenceInterval: 1,
      })
    ).json()) as { item: { id: string } };
    const category = (await (await ann.post("/api/categories", { name: "Shopping", defaultLimitCents: null })).json()) as {
      category: { id: string };
    };
    await split(ann, { ...several, billIncomeId: bill.item.id, categoryId: category.category.id });

    const saved = await listed(ann);
    expect(saved).toHaveLength(4);
    expect(new Set(saved.map((transaction) => transaction.billIncomeId))).toEqual(new Set([bill.item.id]));
    expect(new Set(saved.map((transaction) => transaction.categoryId))).toEqual(new Set([category.category.id]));
  });
});

describe("a split that runs past the furthest pay period", () => {
  // The furthest period that may exist is the one holding 2027-01-15, a year from today:
  // P28 2027-01-12..01-25. After it, P29 01-26..02-08, P30 02-09..02-22, P31 02-23..03-08.
  const longSplit = { items: [item(2_900, "2027-03-05")] };

  it("works out every share over the whole span, and saves only those up to that period", async () => {
    const result = await split(ann, longSplit);

    // Thirty periods, P2 to P31: twenty shares of 97 cents, then ten of 96.
    expect(result.payments).toHaveLength(27);
    expect(result.payments.at(-1)!.period).toEqual({ startDate: "2027-01-12", endDate: "2027-01-25" });
    expect(result.later.map(({ occursAt, amountCents, period }) => [occursAt, amountCents, period])).toEqual([
      ["2027-01-26T00:00", -96, { startDate: "2027-01-26", endDate: "2027-02-08" }],
      ["2027-02-09T00:00", -96, { startDate: "2027-02-09", endDate: "2027-02-22" }],
      ["2027-02-23T00:00", -96, { startDate: "2027-02-23", endDate: "2027-03-08" }],
    ]);
    const sum = (payments: Array<{ amountCents: number }>) => payments.reduce((total, payment) => total + payment.amountCents, 0);
    expect(sum(result.payments)).toBe(-2_612);
    expect(sum(result.payments) + sum(result.later)).toBe(-2_900);

    const saved = await t.store.transactions.listInRange((await t.store.users.findByUsername("ann"))!.id, "2026-01-01", "2027-12-31");
    expect(saved.map((transaction) => transaction.amountCents)).toEqual(result.payments.map((payment) => payment.amountCents));
    expect(saved.at(-1)!.occursAt).toBe("2027-01-12T00:00");
  });

  it("counts finishing early from the periods past it too", async () => {
    const result = await split(ann, { ...longSplit, finishEarly: true });
    expect(result.later.map((payment) => payment.period.startDate)).toEqual(["2027-01-26", "2027-02-09"]);
  });

  it("follows a hand-moved end of the last period", async () => {
    const userIdOf = async () => (await t.store.users.findByUsername("ann"))!.id;
    await split(ann, { dryRun: true, ...longSplit });
    const located = (await (await ann.post("/api/periods/locate", { date: "2027-01-12" })).json()) as { periodId: string };
    const moved = await ann.patch(`/api/periods/${located.periodId}/dates`, { startDate: "2027-01-12", endDate: "2027-01-20" });
    expect(moved.status, JSON.stringify(await moved.clone().json())).toBe(200);
    expect((await t.store.periods.listAll(await userIdOf())).at(-1)!.endDate).toBe("2027-01-20");

    const result = await split(ann, { dryRun: true, ...longSplit });
    expect(result.later[0]!.period).toEqual({ startDate: "2027-01-21", endDate: "2027-02-08" });
  });

  it("saves only what is in reach when every later share is", async () => {
    const result = await split(ann, { occursAt: "2027-01-20T08:00", items: [item(300, "2027-03-05")] });
    expect(result.payments.map((payment) => [payment.occursAt, payment.amountCents])).toEqual([["2027-01-20T08:00", -75]]);
    expect(result.later.map((payment) => payment.amountCents)).toEqual([-75, -75, -75]);
  });
});

describe("a dry run", () => {
  it("reports exactly what the real run then saves, and saves nothing", async () => {
    const before = await current(ann);
    const preview = await split(ann, { dryRun: true, items: [item(100_000, "2026-06-01")] });

    expect(preview.dryRun).toBe(true);
    expect(preview.current).toEqual({
      periodId: before.period.id,
      projectedBeforeCents: OPENING,
      projectedAfterCents: OPENING + preview.payments[0]!.amountCents,
    });
    expect(await listed(ann)).toEqual([]);
    expect(await current(ann)).toEqual(before);
    // The periods it would have made were rolled back too.
    expect((await t.store.periods.listAll((await t.store.users.findByUsername("ann"))!.id)).at(-1)!.endDate < "2026-05-19").toBe(true);

    const real = await split(ann, { items: [item(100_000, "2026-06-01")] });
    expect({ ...real, dryRun: true }).toEqual(preview);
  });
});

describe("what it refuses", () => {
  it("a due date before the first payment", async () => {
    const error = await refused(ann, { items: [item(1_000, "2026-03-05", "Laptop"), item(1_000, "2026-01-14", "Cable")] });
    expect(error.fields).toEqual({ "items.1.dueDate": "That's before the first payment" });
  });

  it("finishing early what is due in the first payment's period", async () => {
    const error = await refused(ann, { finishEarly: true, items: [item(1_000, "2026-01-20")] });
    expect(error.fields).toEqual({
      "items.0.dueDate": "That's due in the first payment's period, so it can't finish a period earlier",
    });
  });

  it("a due date more than five years after the first payment", async () => {
    const error = await refused(ann, { items: [item(1_000, "2031-01-16")] });
    expect(error.fields).toEqual({ "items.0.dueDate": "Keep it within 5 years of the first payment" });
  });

  it("a first payment more than a year ahead", async () => {
    const error = await refused(ann, { occursAt: "2027-02-01T00:00", items: [item(1_000, "2027-03-05")] });
    expect(error.fields).toEqual({ occursAt: "That's more than a year ahead" });
  });

  it("a first payment before the budget", async () => {
    const error = await refused(ann, { occursAt: "2025-11-01T00:00" });
    expect(error.fields).toEqual({ occursAt: "That's before your earliest pay period" });
  });

  it("several items with one unnamed", async () => {
    const error = await refused(ann, { items: [item(1_000, "2026-03-05", "Laptop"), item(1_000, "2026-03-05")] });
    expect(Object.keys(error.fields ?? {})).toEqual(["items.1.label"]);
  });

  it("payments over the largest amount a transaction may have", async () => {
    const error = await refused(ann, { items: [item(100_000_000, "2026-01-20", "A"), item(100_000_000, "2026-01-20", "B")] });
    expect(error.message).toMatch(/more than \$1,000,000\.00 in one pay period/);
  });

  it("saves nothing when it refuses", async () => {
    await refused(ann, { items: [item(1_000, "2026-03-05", "Laptop"), item(1_000, "2026-01-01", "Cable")] });
    expect(await listed(ann)).toEqual([]);
  });
});

describe("who may split", () => {
  it("requires signing in", async () => {
    expect((await t.client().post("/api/transactions/split", body())).status).toBe(401);
  });

  it("refuses another user's bill or income and category exactly as ones that don't exist", async () => {
    const bob = await signUp("bob");
    const bill = (await (
      await bob.post("/api/bills-income", {
        name: "Bob's",
        kind: "expense",
        defaultAmountCents: 0,
        recurrenceUnit: "none",
        recurrenceInterval: 1,
      })
    ).json()) as { item: { id: string } };
    const category = (await (await bob.post("/api/categories", { name: "Bob's", defaultLimitCents: null })).json()) as {
      category: { id: string };
    };

    const theirs = await refused(ann, { billIncomeId: bill.item.id, categoryId: category.category.id });
    const missing = await refused(ann, { billIncomeId: "no-such-id", categoryId: "no-such-id" });
    expect(theirs).toEqual(missing);
    expect(Object.keys(theirs.fields ?? {}).sort()).toEqual(["billIncomeId", "categoryId"]);
    expect(await listed(ann)).toEqual([]);
    expect(await listed(bob)).toEqual([]);
  });

  it("only ever writes to the caller's own budget", async () => {
    const bob = await signUp("bob");
    await split(bob);
    expect(await listed(ann)).toEqual([]);
    expect((await current(ann)).totals.projectedCents).toBe(OPENING);
  });
});
