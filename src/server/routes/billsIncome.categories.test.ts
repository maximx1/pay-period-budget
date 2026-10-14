import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillOrIncome, BillOrIncomeResponse } from "../../shared/billsIncome.ts";
import type { PeriodSummary, PeriodView } from "../../shared/budget.ts";
import type { Category } from "../../shared/categories.ts";
import type { Transaction, TransactionResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// Locating 2026-03-01 generates P5 2026-02-24..03-09.
// Rent ($900, monthly from 2025-12-25) is generated on Dec 25 (P0), Jan 25 (P2) and Feb 25 (P5).
const OPENING = 100_000;
const RENT = 90_000;

let t: TestApp;
let ann: Client;
let bob: Client;
let groceries: Category;
let housing: Category;
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

async function addCategory(client: Client, name: string): Promise<Category> {
  const response = await client.post("/api/categories", { name });
  expect(response.status).toBe(201);
  return (await response.json()).category;
}

async function addItem(client: Client, overrides: Row = {}): Promise<BillOrIncome> {
  const response = await client.post("/api/bills-income", {
    name: "Rent",
    kind: "expense",
    defaultAmountCents: RENT,
    recurrenceUnit: "month",
    recurrenceInterval: 1,
    firstDueDate: "2025-12-25",
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

async function patchItem(client: Client, id: string, body: Row): Promise<BillOrIncomeResponse> {
  const response = await client.patch(`/api/bills-income/${id}`, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

const payment = (date: string, overrides: Row = {}): Row => ({
  name: "Payment",
  amountCents: 30_000,
  kind: "expense",
  occursAt: `${date}T00:00`,
  paid: true,
  ...overrides,
});

async function create(client: Client, body: Row): Promise<Transaction> {
  const response = await client.post("/api/transactions", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return ((await response.json()) as TransactionResponse).transaction;
}

/** Every transaction the user has, oldest first, as [name, date, category]. */
async function filed(client: Client): Promise<Array<[string, string, string | null]>> {
  const { periods } = (await (await client.get("/api/periods")).json()) as { periods: PeriodSummary[] };
  const rows: Array<[string, string, string | null]> = [];
  for (const { id } of periods) {
    const view = (await (await client.get(`/api/periods/${id}`)).json()) as PeriodView;
    for (const tx of view.transactions) rows.push([tx.name, tx.occursAt.slice(0, 10), tx.categoryId]);
  }
  return rows;
}

async function fieldsOf(response: Response): Promise<Record<string, string>> {
  return (await response.json()).error.fields ?? {};
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  bob = await signUp("bob");
  groceries = await addCategory(ann, "Groceries");
  housing = await addCategory(ann, "Housing");
});
afterEach(() => t.cleanup());

describe("a bill or income with a category", () => {
  it("files every entry it adds under it: back-filled, current and generated later", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });
    expect(rent.categoryId).toBe(housing.id);
    expect(await filed(ann)).toEqual([
      ["Rent", "2025-12-25", housing.id],
      ["Rent", "2026-01-25", housing.id],
    ]);

    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect((await filed(ann)).at(-1)).toEqual(["Rent", "2026-02-25", housing.id]);
    expect((await (await ann.get("/api/bills-income")).json()).items[0].categoryId).toBe(housing.id);
  });

  it("changes nothing that exists when its category is set afterwards, only what it adds from then on", async () => {
    const rent = await addItem(ann);
    expect(rent.categoryId).toBeNull();

    const { item, refiledTransactions } = await patchItem(ann, rent.id, { categoryId: housing.id });
    expect(item.categoryId).toBe(housing.id);
    expect(refiledTransactions).toBeUndefined();
    expect(await filed(ann)).toEqual([
      ["Rent", "2025-12-25", null],
      ["Rent", "2026-01-25", null],
    ]);

    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect((await filed(ann)).at(-1)).toEqual(["Rent", "2026-02-25", housing.id]);
  });

  it("refiles every transaction tied to it when asked, replacing whatever category each had", async () => {
    const rent = await addItem(ann);
    const card = await addItem(ann, { name: "Card", recurrenceUnit: "none", defaultAmountCents: 0, firstDueDate: undefined });
    await create(ann, payment("2026-01-14", { name: "Late fee", billIncomeId: rent.id, categoryId: groceries.id }));
    await create(ann, payment("2026-01-15", { name: "Deposit top-up", billIncomeId: rent.id }));
    await create(ann, payment("2026-01-16", { name: "Card payment", billIncomeId: card.id, categoryId: groceries.id }));
    await create(ann, payment("2026-01-17", { name: "Coffee", categoryId: groceries.id }));
    // Bob has a bill and a category of the same names.
    const bobsHousing = await addCategory(bob, "Housing");
    await addItem(bob, { categoryId: bobsHousing.id });
    const bobsBefore = await filed(bob);

    const { refiledTransactions } = await patchItem(ann, rent.id, { categoryId: housing.id, applyToTransactions: true });
    // The two generated entries and the two tied by hand; nothing else.
    expect(refiledTransactions).toBe(4);
    expect(await filed(ann)).toEqual([
      ["Rent", "2025-12-25", housing.id],
      ["Late fee", "2026-01-14", housing.id],
      ["Deposit top-up", "2026-01-15", housing.id],
      ["Card payment", "2026-01-16", groceries.id],
      ["Coffee", "2026-01-17", groceries.id],
      ["Rent", "2026-01-25", housing.id],
    ]);
    expect(await filed(bob)).toEqual(bobsBefore);

    // Asked again with nothing to change, nothing is.
    expect((await patchItem(ann, rent.id, { applyToTransactions: true })).refiledTransactions).toBe(0);

    // Taking the category away, when asked, unfiles them all.
    expect((await patchItem(ann, rent.id, { categoryId: null, applyToTransactions: true })).refiledTransactions).toBe(4);
    expect((await filed(ann)).filter(([, , categoryId]) => categoryId === housing.id)).toEqual([]);
    expect((await filed(ann)).filter(([, , categoryId]) => categoryId === groceries.id).length).toBe(2);
  });

  it("refuses a category that doesn't exist and someone else's in the same words", async () => {
    const rent = await addItem(ann);
    const bobsCategory = await addCategory(bob, "Housing");

    for (const categoryId of ["no-such-category", bobsCategory.id]) {
      const onCreate = await ann.post("/api/bills-income", {
        name: "Gym",
        kind: "expense",
        defaultAmountCents: 3_000,
        recurrenceUnit: "month",
        firstDueDate: "2026-01-20",
        categoryId,
      });
      expect(onCreate.status).toBe(400);
      expect(await fieldsOf(onCreate)).toEqual({ categoryId: "No such category" });

      const onUpdate = await ann.patch(`/api/bills-income/${rent.id}`, { categoryId, applyToTransactions: true });
      expect(onUpdate.status).toBe(400);
      expect(await fieldsOf(onUpdate)).toEqual({ categoryId: "No such category" });
    }
    expect((await (await ann.get("/api/bills-income")).json()).items).toHaveLength(1);
    expect((await filed(ann)).every(([, , categoryId]) => categoryId === null)).toBe(true);
  });

  it("goes back to no category when its category is deleted, and keeps everything else", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });

    expect((await ann.delete(`/api/categories/${housing.id}`)).status).toBe(204);

    const [item] = (await (await ann.get("/api/bills-income")).json()).items as BillOrIncome[];
    expect(item).toMatchObject({ id: rent.id, name: "Rent", categoryId: null });
    expect(await filed(ann)).toEqual([
      ["Rent", "2025-12-25", null],
      ["Rent", "2026-01-25", null],
    ]);
  });
});

describe("a transaction tied to a bill or income by hand", () => {
  it("takes the item's category unless it names its own or says none", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });

    expect((await create(ann, payment("2026-01-14", { billIncomeId: rent.id }))).categoryId).toBe(housing.id);
    expect((await create(ann, payment("2026-01-14", { billIncomeId: rent.id, categoryId: groceries.id }))).categoryId).toBe(
      groceries.id,
    );
    expect((await create(ann, payment("2026-01-14", { billIncomeId: rent.id, categoryId: null }))).categoryId).toBeNull();
    // Tied to nothing, it takes nothing.
    expect((await create(ann, payment("2026-01-14"))).categoryId).toBeNull();
  });

  it("does the same for each row of an import", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });

    const response = await ann.post("/api/transactions/import", {
      transactions: [
        payment("2026-01-14", { name: "a", billIncomeId: rent.id }),
        payment("2026-01-14", { name: "b", billIncomeId: rent.id, categoryId: groceries.id }),
        payment("2026-01-14", { name: "c", billIncomeId: rent.id, categoryId: null }),
        payment("2026-01-14", { name: "d" }),
      ],
    });
    expect(response.status).toBe(200);
    expect((await filed(ann)).filter(([, date]) => date === "2026-01-14")).toEqual([
      ["a", "2026-01-14", housing.id],
      ["b", "2026-01-14", groceries.id],
      ["c", "2026-01-14", null],
      ["d", "2026-01-14", null],
    ]);
  });

  it("takes the category of the entry it pays toward, which may not be the item's", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });
    const view = (await (await ann.get("/api/periods/current")).json()) as PeriodView;
    const due = view.transactions.find((tx) => tx.billIncomeId === rent.id)!;
    // The entry was refiled by hand after it was added.
    await ann.patch(`/api/transactions/${due.id}`, { categoryId: groceries.id });

    expect((await create(ann, payment("2026-01-20", { countsToward: due.id }))).categoryId).toBe(groceries.id);
    expect((await create(ann, payment("2026-01-21", { countsToward: due.id, categoryId: null }))).categoryId).toBeNull();
  });

  it("keeps its category when it is later tied to something else, or untied", async () => {
    const rent = await addItem(ann, { categoryId: housing.id });
    const card = await addItem(ann, { name: "Card", recurrenceUnit: "none", defaultAmountCents: 0, firstDueDate: undefined });
    const coffee = await create(ann, payment("2026-01-14", { name: "Coffee", categoryId: groceries.id }));
    const plain = await create(ann, payment("2026-01-14", { name: "Plain" }));

    const tied = await ann.patch(`/api/transactions/${coffee.id}`, { billIncomeId: rent.id });
    expect(((await tied.json()) as TransactionResponse).transaction).toMatchObject({ billIncomeId: rent.id, categoryId: groceries.id });
    const tiedPlain = await ann.patch(`/api/transactions/${plain.id}`, { billIncomeId: rent.id });
    expect(((await tiedPlain.json()) as TransactionResponse).transaction).toMatchObject({ billIncomeId: rent.id, categoryId: null });
    const moved = await ann.patch(`/api/transactions/${coffee.id}`, { billIncomeId: card.id });
    expect(((await moved.json()) as TransactionResponse).transaction.categoryId).toBe(groceries.id);
    const untied = await ann.patch(`/api/transactions/${coffee.id}`, { billIncomeId: null });
    expect(((await untied.json()) as TransactionResponse).transaction.categoryId).toBe(groceries.id);
  });
});
