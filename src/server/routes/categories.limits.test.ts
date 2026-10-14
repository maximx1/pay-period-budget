import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodSummary, PeriodView } from "../../shared/budget.ts";
import { type Category, overLimitMessage, type PeriodCategoryLimit } from "../../shared/categories.ts";
import type { TransactionResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// Locating 2026-03-01 generates P5 2026-02-24..03-09.
const OPENING = 100_000;

let t: TestApp;
let ann: Client;
let bob: Client;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

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
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

async function addCategory(client: Client, body: Row): Promise<Category> {
  const response = await client.post("/api/categories", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).category;
}

async function patchCategory(client: Client, id: string, body: Row): Promise<Category> {
  const response = await client.patch(`/api/categories/${id}`, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()).category;
}

const periodsOf = async (client: Client): Promise<PeriodSummary[]> => (await (await client.get("/api/periods")).json()).periods;
const viewOf = async (client: Client, id: string): Promise<PeriodView> => (await client.get(`/api/periods/${id}`)).json();
const current = async (client: Client): Promise<PeriodView> => (await client.get("/api/periods/current")).json();

/** Each period's limit for one category, oldest period first; null where it has none. */
async function limitsAcross(client: Client, categoryId: string): Promise<Array<number | null>> {
  const limits: Array<number | null> = [];
  for (const { id } of await periodsOf(client)) {
    const found = (await viewOf(client, id)).categoryLimits.find((limit) => limit.categoryId === categoryId);
    limits.push(found?.limitCents ?? null);
  }
  return limits;
}

async function startingAmounts(client: Client): Promise<number[]> {
  const amounts: number[] = [];
  for (const { id } of await periodsOf(client)) amounts.push((await viewOf(client, id)).period.startingCents);
  return amounts;
}

const spend = (date: string, amountCents: number, overrides: Row = {}): Row => ({
  name: "Shop",
  amountCents,
  kind: "expense",
  occursAt: `${date}T00:00`,
  paid: true,
  ...overrides,
});

async function create(client: Client, body: Row): Promise<TransactionResponse> {
  const response = await client.post("/api/transactions", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return response.json();
}

async function setLimit(client: Client, periodId: string, categoryId: string, limitCents: number): Promise<PeriodView> {
  const response = await client.put(`/api/periods/${periodId}/limits/${categoryId}`, { limitCents });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  bob = await signUp("bob");
});
afterEach(() => t.cleanup());

describe("what counts against a limit", () => {
  it("follows the owner's example: paid, then upcoming, then paid, then a refund", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const only = async (): Promise<PeriodCategoryLimit> => {
      const { categoryLimits } = await current(ann);
      expect(categoryLimits).toHaveLength(1);
      return categoryLimits[0]!;
    };

    await create(ann, spend("2026-01-14", 12_000, { categoryId: groceries.id }));
    expect(await only()).toEqual({
      categoryId: groceries.id,
      name: "Groceries",
      limitCents: 20_000,
      spentCents: 12_000,
      paidSpentCents: 12_000,
    });
    expect(overLimitMessage(await only())).toBeNull();

    const upcoming = await create(ann, spend("2026-01-20", 9_500, { categoryId: groceries.id, paid: false }));
    expect(await only()).toMatchObject({ spentCents: 21_500, paidSpentCents: 12_000 });
    expect(overLimitMessage(await only())).toBe("You're set to go over your budget for Groceries by $15.00 this period.");

    await ann.patch(`/api/transactions/${upcoming.transaction.id}`, { status: "paid" });
    expect(await only()).toMatchObject({ spentCents: 21_500, paidSpentCents: 21_500 });
    expect(overLimitMessage(await only())).toBe("You went over your budget for Groceries by $15.00 this period.");

    // Money back under the same category lowers what was spent on it.
    await create(ann, spend("2026-01-21", 2_000, { kind: "income", name: "Refund", categoryId: groceries.id }));
    expect(await only()).toMatchObject({ spentCents: 19_500, paidSpentCents: 19_500 });
    expect(overLimitMessage(await only())).toBeNull();
  });

  it("counts only what is filed under the category, in this period", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const car = await addCategory(ann, { name: "Car", defaultLimitCents: 5_000, applyToPeriods: true });
    await create(ann, spend("2026-01-14", 3_000, { categoryId: groceries.id }));
    await create(ann, spend("2026-01-14", 7_000, { categoryId: car.id }));
    await create(ann, spend("2026-01-14", 50_000)); // filed under nothing
    await create(ann, spend("2026-01-10", 9_000, { categoryId: groceries.id })); // the period before
    await create(ann, spend("2026-01-27", 9_000, { categoryId: groceries.id })); // the period after

    // By name.
    expect((await current(ann)).categoryLimits.map(({ name, spentCents }) => [name, spentCents])).toEqual([
      ["Car", 7_000],
      ["Groceries", 3_000],
    ]);
  });

  it("is not over at exactly the limit, never goes below zero, and a limit of zero allows nothing", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const takeaway = await addCategory(ann, { name: "Takeaway", defaultLimitCents: 0, applyToPeriods: true });
    const { transaction } = await create(ann, spend("2026-01-14", 20_000, { categoryId: groceries.id }));
    const limitOf = async (id: string) => (await current(ann)).categoryLimits.find((limit) => limit.categoryId === id)!;

    expect(overLimitMessage(await limitOf(groceries.id))).toBeNull();
    await ann.patch(`/api/transactions/${transaction.id}`, { amountCents: 20_001 });
    expect(overLimitMessage(await limitOf(groceries.id))).toBe(
      "You went over your budget for Groceries by $0.01 this period.",
    );

    // More coming back than went out is no spending, not negative spending.
    await create(ann, spend("2026-01-15", 90_000, { kind: "income", name: "Refund", categoryId: groceries.id }));
    expect(await limitOf(groceries.id)).toMatchObject({ spentCents: 0, paidSpentCents: 0 });

    expect(overLimitMessage(await limitOf(takeaway.id))).toBeNull();
    await create(ann, spend("2026-01-16", 1, { categoryId: takeaway.id }));
    expect(overLimitMessage(await limitOf(takeaway.id))).toBe("You went over your budget for Takeaway by $0.01 this period.");
  });

  it("follows a period's boundary: the spending moves with the days, the limit stays", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const [, , p2, p3] = await periodsOf(ann);
    await setLimit(ann, p3!.id, groceries.id, 30_000);
    await create(ann, spend("2026-01-26", 4_000, { categoryId: groceries.id })); // P2's last day

    expect((await viewOf(ann, p2!.id)).categoryLimits[0]).toMatchObject({ limitCents: 20_000, spentCents: 4_000 });
    // P2 gives its last day to P3.
    expect((await ann.patch(`/api/periods/${p2!.id}/dates`, { endDate: "2026-01-25" })).status).toBe(200);
    expect((await viewOf(ann, p2!.id)).categoryLimits[0]).toMatchObject({ limitCents: 20_000, spentCents: 0 });
    expect((await viewOf(ann, p3!.id)).categoryLimits[0]).toMatchObject({ limitCents: 30_000, spentCents: 4_000 });
  });
});

describe("how limits come and go", () => {
  it("gives the usual limit to the current and later periods when asked, and never to earlier ones", async () => {
    const asked = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    expect(await limitsAcross(ann, asked.id)).toEqual([null, null, 20_000, 20_000, 20_000]);

    const notAsked = await addCategory(ann, { name: "Car", defaultLimitCents: 5_000 });
    expect(await limitsAcross(ann, notAsked.id)).toEqual([null, null, null, null, null]);

    // Asking with no usual limit gives nothing to anyone.
    const none = await addCategory(ann, { name: "Misc", applyToPeriods: true });
    expect(await limitsAcross(ann, none.id)).toEqual([null, null, null, null, null]);
  });

  it("gives every category's usual limit to a period generated later, asked or not", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const car = await addCategory(ann, { name: "Car", defaultLimitCents: 5_000 });
    const misc = await addCategory(ann, { name: "Misc" });

    expect((await ann.post("/api/periods/locate", { date: "2026-03-01" })).status).toBe(200);

    expect(await limitsAcross(ann, groceries.id)).toEqual([null, null, 20_000, 20_000, 20_000, 20_000]);
    expect(await limitsAcross(ann, car.id)).toEqual([null, null, null, null, null, 5_000]);
    expect(await limitsAcross(ann, misc.id)).toEqual([null, null, null, null, null, null]);
  });

  it("gives none to a period added before the earliest", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });

    const added = await ann.post("/api/periods/earlier");
    expect(added.status).toBe(200);

    expect(await limitsAcross(ann, groceries.id)).toEqual([null, null, null, 20_000, 20_000, 20_000]);
  });

  it("changes only later-generated periods when the usual limit changes without asking", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });

    expect((await patchCategory(ann, groceries.id, { defaultLimitCents: 25_000 })).defaultLimitCents).toBe(25_000);
    expect(await limitsAcross(ann, groceries.id)).toEqual([null, null, 20_000, 20_000, 20_000]);

    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect(await limitsAcross(ann, groceries.id)).toEqual([null, null, 20_000, 20_000, 20_000, 25_000]);
  });

  it("replaces the current and later periods' limits when asked, one set by hand included, and leaves past ones", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const [p0, , , p3] = await periodsOf(ann);
    await setLimit(ann, p0!.id, groceries.id, 11_100); // a past period, by hand
    await setLimit(ann, p3!.id, groceries.id, 33_300); // a later period, by hand
    expect(await limitsAcross(ann, groceries.id)).toEqual([11_100, null, 20_000, 33_300, 20_000]);

    await patchCategory(ann, groceries.id, { defaultLimitCents: 25_000, applyToPeriods: true });
    expect(await limitsAcross(ann, groceries.id)).toEqual([11_100, null, 25_000, 25_000, 25_000]);

    // Taking the usual limit away, when asked, takes theirs away too.
    await patchCategory(ann, groceries.id, { defaultLimitCents: null, applyToPeriods: true });
    expect(await limitsAcross(ann, groceries.id)).toEqual([11_100, null, null, null, null]);
    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect(await limitsAcross(ann, groceries.id)).toEqual([11_100, null, null, null, null, null]);
  });

  it("leaves limits alone when the usual one is taken away without asking", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    await patchCategory(ann, groceries.id, { defaultLimitCents: null });
    expect(await limitsAcross(ann, groceries.id)).toEqual([null, null, 20_000, 20_000, 20_000]);
  });

  it("shows a renamed category under its new name", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    await patchCategory(ann, groceries.id, { name: "Food" });
    expect((await current(ann)).categoryLimits.map((limit) => limit.name)).toEqual(["Food"]);
  });

  it("removes a deleted category's limits from every period", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const car = await addCategory(ann, { name: "Car", defaultLimitCents: 5_000, applyToPeriods: true });

    expect((await ann.delete(`/api/categories/${groceries.id}`)).status).toBe(204);

    for (const { id } of await periodsOf(ann)) {
      expect((await viewOf(ann, id)).categoryLimits.every((limit) => limit.categoryId === car.id)).toBe(true);
    }
    expect(await limitsAcross(ann, car.id)).toEqual([null, null, 5_000, 5_000, 5_000]);
  });
});

describe("a period's own limit", () => {
  it("can be set, changed and removed in any period, past ones and ones before the budget included", async () => {
    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000 });
    await create(ann, spend("2025-12-20", 4_000, { categoryId: groceries.id }));
    const earlierId = (await (await ann.post("/api/periods/earlier")).json()).periodId as string;
    const [, p0] = await periodsOf(ann);

    const past = await setLimit(ann, p0!.id, groceries.id, 3_000);
    expect(past.period.id).toBe(p0!.id);
    expect(past.categoryLimits).toEqual([
      { categoryId: groceries.id, name: "Groceries", limitCents: 3_000, spentCents: 4_000, paidSpentCents: 4_000 },
    ]);
    expect((await setLimit(ann, p0!.id, groceries.id, 4_500)).categoryLimits[0]?.limitCents).toBe(4_500);
    expect((await setLimit(ann, earlierId, groceries.id, 1_000)).categoryLimits[0]?.limitCents).toBe(1_000);
    expect(await limitsAcross(ann, groceries.id)).toEqual([1_000, 4_500, null, null, null, null]);

    const removed = await ann.delete(`/api/periods/${p0!.id}/limits/${groceries.id}`);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as PeriodView).categoryLimits).toEqual([]);
    expect(await limitsAcross(ann, groceries.id)).toEqual([1_000, null, null, null, null, null]);
    // The usual limit is the category's own and is untouched by any of this.
    expect((await (await ann.get("/api/categories")).json()).categories[0].defaultLimitCents).toBe(20_000);

    // There is nothing left to remove.
    expect((await ann.delete(`/api/periods/${p0!.id}/limits/${groceries.id}`)).status).toBe(404);
  });

  it("moves no money: no limit change touches a starting amount or a total", async () => {
    await create(ann, spend("2025-12-20", 4_000));
    const before = await startingAmounts(ann);
    const totalsBefore = (await current(ann)).totals;

    const groceries = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const [p0] = await periodsOf(ann);
    await setLimit(ann, p0!.id, groceries.id, 100);
    await patchCategory(ann, groceries.id, { defaultLimitCents: 1, applyToPeriods: true });
    await ann.delete(`/api/periods/${p0!.id}/limits/${groceries.id}`);

    expect(await startingAmounts(ann)).toEqual(before);
    expect((await current(ann)).totals).toEqual(totalsBefore);
  });

  it("validates the amount", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const [p0] = await periodsOf(ann);
    const path = `/api/periods/${p0!.id}/limits/${groceries.id}`;

    expect((await ann.put(path, { limitCents: -1 })).status).toBe(400);
    expect((await ann.put(path, { limitCents: 12.5 })).status).toBe(400);
    expect((await ann.put(path, {})).status).toBe(400);
    expect((await ann.put(path, { limitCents: 0 })).status).toBe(200);
  });

  it("is out of another user's reach, by the period and by the category", async () => {
    const annsCategory = await addCategory(ann, { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true });
    const bobsCategory = await addCategory(bob, { name: "Groceries" });
    const annsPeriod = (await current(ann)).period.id;
    const bobsPeriod = (await current(bob)).period.id;

    // Bob reaching into Ann's period, with her category or his own.
    expect((await bob.put(`/api/periods/${annsPeriod}/limits/${annsCategory.id}`, { limitCents: 1 })).status).toBe(404);
    expect((await bob.put(`/api/periods/${annsPeriod}/limits/${bobsCategory.id}`, { limitCents: 1 })).status).toBe(404);
    expect((await bob.delete(`/api/periods/${annsPeriod}/limits/${annsCategory.id}`)).status).toBe(404);
    // Bob putting Ann's category on his own period.
    expect((await bob.put(`/api/periods/${bobsPeriod}/limits/${annsCategory.id}`, { limitCents: 1 })).status).toBe(404);
    expect((await bob.delete(`/api/periods/${bobsPeriod}/limits/${annsCategory.id}`)).status).toBe(404);

    expect((await current(ann)).categoryLimits.map((limit) => limit.limitCents)).toEqual([20_000]);
    expect((await current(bob)).categoryLimits).toEqual([]);
    // One user's usual limits never reach another's periods.
    await bob.post("/api/periods/locate", { date: "2026-03-01" });
    for (const { id } of await periodsOf(bob)) expect((await viewOf(bob, id)).categoryLimits).toEqual([]);
  });
});
