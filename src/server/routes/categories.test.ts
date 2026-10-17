import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { BillOrIncome } from "../../shared/billsIncome.ts";
import type { Category } from "../../shared/categories.ts";
import type { Transaction, TransactionImportResponse, TransactionResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
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

const listCategories = async (client: Client): Promise<Category[]> =>
  (await (await client.get("/api/categories")).json()).categories;

const spend = (date: string, overrides: Row = {}): Row => ({
  name: "Shop",
  amountCents: 4_000,
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

const current = async (client: Client): Promise<PeriodView> => (await client.get("/api/periods/current")).json();

const listed = async (client: Client, from: string, to: string): Promise<Transaction[]> =>
  (await (await client.get(`/api/transactions?from=${from}&to=${to}`)).json()).transactions;

/** Every period's starting amount, oldest first. */
async function startingAmounts(client: Client): Promise<number[]> {
  const { periods } = await (await client.get("/api/periods")).json();
  const amounts: number[] = [];
  for (const { id } of periods) amounts.push(((await (await client.get(`/api/periods/${id}`)).json()) as PeriodView).period.startingCents);
  return amounts;
}

async function fieldsOf(response: Response): Promise<Record<string, string>> {
  return (await response.json()).error.fields ?? {};
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  bob = await signUp("bob");
});
afterEach(() => t.cleanup());

describe("categories", () => {
  it("creates, lists by name, renames and deletes", async () => {
    expect(await listCategories(ann)).toEqual([]);

    const groceries = await addCategory(ann, { name: " Groceries " });
    expect(groceries).toEqual({ id: expect.any(String), name: "Groceries", defaultLimitCents: null });
    await addCategory(ann, { name: "eating out", defaultLimitCents: 8_000 });
    await addCategory(ann, { name: "Car" });
    expect((await listCategories(ann)).map(({ name, defaultLimitCents }) => [name, defaultLimitCents])).toEqual([
      ["Car", null],
      ["eating out", 8_000],
      ["Groceries", null],
    ]);

    const renamed = await ann.patch(`/api/categories/${groceries.id}`, { name: "Food", defaultLimitCents: 20_000 });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).category).toEqual({ id: groceries.id, name: "Food", defaultLimitCents: 20_000 });
    // A change that leaves the name out leaves the name alone; null takes the usual limit away.
    const cleared = await ann.patch(`/api/categories/${groceries.id}`, { defaultLimitCents: null });
    expect((await cleared.json()).category).toEqual({ id: groceries.id, name: "Food", defaultLimitCents: null });

    expect((await ann.delete(`/api/categories/${groceries.id}`)).status).toBe(204);
    expect((await listCategories(ann)).map(({ name }) => name)).toEqual(["Car", "eating out"]);
    expect((await ann.delete(`/api/categories/${groceries.id}`)).status).toBe(404);
  });

  it("refuses a name already in use, whatever its capitals, on create and on rename", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const car = await addCategory(ann, { name: "Car" });

    const again = await ann.post("/api/categories", { name: "groceries" });
    expect(again.status).toBe(400);
    expect(await fieldsOf(again)).toEqual({ name: "You already have a category with that name" });

    const rename = await ann.patch(`/api/categories/${car.id}`, { name: "GROCERIES" });
    expect(rename.status).toBe(400);
    expect(await fieldsOf(rename)).toEqual({ name: "You already have a category with that name" });

    // Changing only the capitals of its own name is not a clash with itself.
    expect((await ann.patch(`/api/categories/${groceries.id}`, { name: "GROCERIES" })).status).toBe(200);
    // Someone else's category of the same name is no clash either.
    await addCategory(bob, { name: "Groceries" });
    expect((await listCategories(ann)).length).toBe(2);
  });

  it("validates the name and the usual limit", async () => {
    expect(await fieldsOf(await ann.post("/api/categories", { name: "  " }))).toEqual({ name: "Enter a name" });
    expect(await fieldsOf(await ann.post("/api/categories", { name: "x".repeat(41) }))).toHaveProperty("name");
    expect(await fieldsOf(await ann.post("/api/categories", { name: "A", defaultLimitCents: -1 }))).toEqual({
      defaultLimitCents: "Enter zero or more",
    });
    expect(await fieldsOf(await ann.post("/api/categories", { name: "A", defaultLimitCents: 10.5 }))).toHaveProperty(
      "defaultLimitCents",
    );
    // Zero is a limit ("spend nothing"), not the lack of one.
    expect((await addCategory(ann, { name: "Takeaway", defaultLimitCents: 0 })).defaultLimitCents).toBe(0);
    expect((await ann.patch("/api/categories/whatever", {})).status).toBe(400);
  });

  it("keeps one user's categories out of another's reach", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });

    expect(await listCategories(bob)).toEqual([]);
    expect((await bob.patch(`/api/categories/${groceries.id}`, { name: "Mine now" })).status).toBe(404);
    expect((await bob.delete(`/api/categories/${groceries.id}`)).status).toBe(404);
    expect(await listCategories(ann)).toEqual([groceries]);

    const signedOut = t.client();
    expect((await signedOut.get("/api/categories")).status).toBe(401);
    expect((await signedOut.post("/api/categories", { name: "Nope" })).status).toBe(401);
  });
});

describe("filing a transaction under a category", () => {
  it("files on create, moves and unfiles on update, and reports it wherever the transaction appears", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const car = await addCategory(ann, { name: "Car" });

    const { transaction } = await create(ann, spend("2026-01-20", { categoryId: groceries.id }));
    expect(transaction.categoryId).toBe(groceries.id);
    const plain = await create(ann, spend("2026-01-21"));
    expect(plain.transaction.categoryId).toBeNull();
    expect((await create(ann, spend("2026-01-22", { categoryId: null }))).transaction.categoryId).toBeNull();

    expect((await current(ann)).transactions.map((tx) => tx.categoryId)).toEqual([groceries.id, null, null]);
    expect((await listed(ann, "2026-01-20", "2026-01-20"))[0]?.categoryId).toBe(groceries.id);

    const moved = await ann.patch(`/api/transactions/${transaction.id}`, { categoryId: car.id });
    expect(((await moved.json()) as TransactionResponse).transaction.categoryId).toBe(car.id);
    // A change that says nothing about the category leaves it alone.
    const renamed = await ann.patch(`/api/transactions/${transaction.id}`, { name: "Tyres" });
    expect(((await renamed.json()) as TransactionResponse).transaction).toMatchObject({ name: "Tyres", categoryId: car.id });
    const unfiled = await ann.patch(`/api/transactions/${transaction.id}`, { categoryId: null });
    expect(((await unfiled.json()) as TransactionResponse).transaction.categoryId).toBeNull();
  });

  it("refuses a category that doesn't exist and someone else's in the same words", async () => {
    const bobs = await addCategory(bob, { name: "Groceries" });
    const { transaction } = await create(ann, spend("2026-01-20"));

    for (const categoryId of ["no-such-category", bobs.id]) {
      const onCreate = await ann.post("/api/transactions", spend("2026-01-21", { categoryId }));
      expect(onCreate.status).toBe(400);
      expect(await fieldsOf(onCreate)).toEqual({ categoryId: "No such category" });

      const onUpdate = await ann.patch(`/api/transactions/${transaction.id}`, { categoryId });
      expect(onUpdate.status).toBe(400);
      expect(await fieldsOf(onUpdate)).toEqual({ categoryId: "No such category" });

      const onImport = await ann.post("/api/transactions/import", {
        transactions: [spend("2026-01-21"), spend("2026-01-22", { categoryId })],
      });
      expect(onImport.status).toBe(400);
      expect(await fieldsOf(onImport)).toEqual({ "transactions.1.categoryId": "No such category" });
    }
    // Nothing was saved by any of those.
    expect((await current(ann)).transactions.map((tx) => tx.categoryId)).toEqual([null]);
  });

  it("files rows of an import, each under its own", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const car = await addCategory(ann, { name: "Car" });

    const response = await ann.post("/api/transactions/import", {
      transactions: [
        spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }),
        spend("2026-01-21", { name: "Petrol", categoryId: car.id }),
        spend("2026-01-22", { name: "Unfiled" }),
      ],
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TransactionImportResponse).created).toBe(3);
    expect((await current(ann)).transactions.map((tx) => [tx.name, tx.categoryId])).toEqual([
      ["Kroger", groceries.id],
      ["Petrol", car.id],
      ["Unfiled", null],
    ]);
  });

  it("moves no money: filing, refiling and unfiling leave every starting amount as it was", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const { transaction } = await create(ann, spend("2025-12-20"));
    const before = await startingAmounts(ann);
    const totalsBefore = (await current(ann)).totals;

    await ann.patch(`/api/transactions/${transaction.id}`, { categoryId: groceries.id });
    expect(await startingAmounts(ann)).toEqual(before);
    await ann.patch(`/api/transactions/${transaction.id}`, { categoryId: null });
    expect(await startingAmounts(ann)).toEqual(before);
    expect((await current(ann)).totals).toEqual(totalsBefore);
  });

  it("leaves a deleted category's transactions in place, filed under nothing", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const car = await addCategory(ann, { name: "Car" });
    await create(ann, spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }));
    await create(ann, spend("2026-01-21", { name: "Petrol", categoryId: car.id }));
    const before = await startingAmounts(ann);

    expect((await ann.delete(`/api/categories/${groceries.id}`)).status).toBe(204);

    expect((await current(ann)).transactions.map((tx) => [tx.name, tx.categoryId])).toEqual([
      ["Kroger", null],
      ["Petrol", car.id],
    ]);
    expect(await startingAmounts(ann)).toEqual(before);
  });
});

describe("moving everything under a category to another", () => {
  const addBill = async (client: Client, name: string, categoryId: string): Promise<BillOrIncome> => {
    const response = await client.post("/api/bills-income", {
      name,
      kind: "expense",
      defaultAmountCents: 50_000,
      recurrenceUnit: "month",
      recurrenceInterval: 1,
      firstDueDate: "2025-12-25",
      categoryId,
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    return (await response.json()).item;
  };
  const billsIncome = async (client: Client): Promise<BillOrIncome[]> =>
    (await (await client.get("/api/bills-income")).json()).items;
  const setLimit = async (client: Client, categoryId: string, limitCents: number) => {
    const { period } = await current(client);
    expect((await client.put(`/api/periods/${period.id}/limits/${categoryId}`, { limitCents })).status).toBe(200);
  };
  const limitsNow = async (client: Client) =>
    (await current(client)).categoryLimits.map(({ categoryId, limitCents }) => [categoryId, limitCents]);
  const categoryOf = async (client: Client) =>
    Object.fromEntries((await listed(client, "2025-12-16", "2026-02-23")).map((tx) => [tx.name, tx.categoryId]));

  it("moves every transaction, past ones too, and every bill or income, and keeps the emptied category", async () => {
    const food = await addCategory(ann, { name: "Food" });
    const groceries = await addCategory(ann, { name: "Groceries" });
    const car = await addCategory(ann, { name: "Car" });
    await create(ann, spend("2025-12-20", { name: "Old Kroger", categoryId: groceries.id }));
    await create(ann, spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }));
    await create(ann, spend("2026-01-21", { name: "Petrol", categoryId: car.id }));
    await create(ann, spend("2026-01-22", { name: "Loose" }));
    const box = await addBill(ann, "Veg box", groceries.id);
    const insurance = await addBill(ann, "Insurance", car.id);
    const fromBox = (await listed(ann, "2025-12-16", "2026-02-23")).filter((tx) => tx.billIncomeId === box.id).length;
    expect(fromBox).toBeGreaterThan(0);
    const before = await startingAmounts(ann);

    const response = await ann.post(`/api/categories/${groceries.id}/move`, { toCategoryId: food.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactions: 2 + fromBox, billsIncome: 1, deleted: false });

    expect(await categoryOf(ann)).toMatchObject({ "Old Kroger": food.id, Kroger: food.id, Petrol: car.id, Loose: null });
    expect(Object.fromEntries((await billsIncome(ann)).map((item) => [item.id, item.categoryId]))).toEqual({
      [box.id]: food.id,
      [insurance.id]: car.id,
    });
    expect((await listCategories(ann)).map(({ name }) => name)).toEqual(["Car", "Food", "Groceries"]);
    expect(await startingAmounts(ann)).toEqual(before);

    // An empty category moves nothing, and that is no error.
    const again = await ann.post(`/api/categories/${groceries.id}/move`, { toCategoryId: food.id });
    expect(await again.json()).toEqual({ transactions: 0, billsIncome: 0, deleted: false });
  });

  it("merges when asked: deletes the emptied category and its limits, and the other keeps its own", async () => {
    const food = await addCategory(ann, { name: "Food" });
    const groceries = await addCategory(ann, { name: "Groceries" });
    const takeaway = await addCategory(ann, { name: "Takeaway" });
    await setLimit(ann, food.id, 30_000);
    await setLimit(ann, groceries.id, 20_000);
    await setLimit(ann, takeaway.id, 5_000);
    await create(ann, spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }));

    const response = await ann.post(`/api/categories/${groceries.id}/move`, { toCategoryId: food.id, deleteAfter: true });
    expect(await response.json()).toEqual({ transactions: 1, billsIncome: 0, deleted: true });

    expect((await listCategories(ann)).map(({ name }) => name)).toEqual(["Food", "Takeaway"]);
    expect(await categoryOf(ann)).toMatchObject({ Kroger: food.id });
    expect(await limitsNow(ann)).toEqual([
      [food.id, 30_000],
      [takeaway.id, 5_000],
    ]);
    // Its spending now counts against the limit of the category it went to.
    expect((await current(ann)).categoryLimits.find((limit) => limit.categoryId === food.id)?.spentCents).toBe(4_000);
  });

  it("refuses the same category, one that doesn't exist and someone else's, and moves nothing", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const bobs = await addCategory(bob, { name: "Food" });
    await create(ann, spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }));

    const same = await ann.post(`/api/categories/${groceries.id}/move`, { toCategoryId: groceries.id, deleteAfter: true });
    expect(same.status).toBe(400);
    expect(await fieldsOf(same)).toEqual({ toCategoryId: "Choose a different category" });
    for (const toCategoryId of ["no-such-category", bobs.id]) {
      const response = await ann.post(`/api/categories/${groceries.id}/move`, { toCategoryId, deleteAfter: true });
      expect(response.status).toBe(400);
      expect(await fieldsOf(response)).toEqual({ toCategoryId: "No such category" });
    }
    expect(await fieldsOf(await ann.post(`/api/categories/${groceries.id}/move`, {}))).toHaveProperty("toCategoryId");

    expect(await categoryOf(ann)).toMatchObject({ Kroger: groceries.id });
    expect((await listCategories(ann)).map(({ name }) => name)).toEqual(["Groceries"]);
  });

  it("keeps one user's categories out of another's reach", async () => {
    const groceries = await addCategory(ann, { name: "Groceries" });
    const anns = await addCategory(ann, { name: "Food" });
    const bobs = await addCategory(bob, { name: "Food" });
    await create(ann, spend("2026-01-20", { name: "Kroger", categoryId: groceries.id }));

    // Bob can't empty Ann's category into his own, or into another of hers.
    for (const toCategoryId of [bobs.id, anns.id]) {
      expect((await bob.post(`/api/categories/${groceries.id}/move`, { toCategoryId, deleteAfter: true })).status).toBe(404);
    }
    expect(await categoryOf(ann)).toMatchObject({ Kroger: groceries.id });
    expect((await listCategories(ann)).length).toBe(2);
    expect((await t.client().post(`/api/categories/${groceries.id}/move`, { toCategoryId: anns.id })).status).toBe(401);
  });
});
