import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { BillOrIncome, BillOrIncomeTransactionsResponse } from "../../shared/billsIncome.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

/** Somewhere money is moved to now and then, and brought back from: no schedule, no usual amount. */
const taxes = (overrides: Row = {}): Row => ({
  name: "Taxes savings",
  kind: "transfer",
  defaultAmountCents: 0,
  recurrenceUnit: "none",
  ...overrides,
});

async function addItem(client: Client, body: Row): Promise<BillOrIncome> {
  const response = await client.post("/api/bills-income", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

async function move(client: Client, date: string, kind: "expense" | "income", amountCents: number, overrides: Row = {}) {
  const response = await client.post("/api/transactions", {
    name: kind === "expense" ? "To savings" : "From savings",
    amountCents,
    kind,
    occursAt: `${date}T00:00`,
    paid: true,
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction.id as string;
}

async function totalsOf(client: Client, id: string) {
  const response = await client.get(`/api/bills-income/${id}/transactions`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return ((await response.json()) as BillOrIncomeTransactionsResponse).totals;
}

async function refusedFields(response: Response): Promise<Record<string, string>> {
  expect(response.status).toBe(400);
  return (await response.json()).error.fields;
}

const current = async (client: Client) => (await (await client.get("/api/periods/current")).json()) as PeriodView;
const startings = async () => {
  const id = (await t.store.users.findByUsername("ann"))!.id;
  return (await t.store.periods.listAll(id)).map((period) => period.startingCents);
};
const transactionsOf = async (itemId: string) => {
  const id = (await t.store.users.findByUsername("ann"))!.id;
  return (await t.store.transactions.listInRange(id, "2025-01-01", "2027-12-31")).filter(
    (transaction) => transaction.billIncomeId === itemId,
  );
};

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("a transfer: money that goes to another account and comes back", () => {
  it("handles the owner's case: set aside now and then, brought back, then spent", async () => {
    const item = await addItem(ann, taxes());
    expect(item).toMatchObject({ kind: "transfer", openingCents: 0, recurrenceUnit: "none" });

    // Set aside three times: each is money out of the budget.
    const before = (await current(ann)).totals.projectedCents;
    await move(ann, "2026-01-14", "expense", 40_000, { billIncomeId: item.id });
    await move(ann, "2026-01-16", "expense", 60_000, { billIncomeId: item.id });
    await move(ann, "2026-01-18", "expense", 50_000, { billIncomeId: item.id });
    const setAside = (await current(ann)).totals.projectedCents;
    expect(setAside).toBe(before - 150_000);
    expect(await totalsOf(ann, item.id)).toEqual({
      count: 3,
      paidCents: -150_000,
      upcomingCents: 0,
      paidOutCents: 150_000,
      paidInCents: 0,
      balanceCents: 150_000,
    });

    // Tax time: it comes back into checking, tied to the same item, and goes out as a check
    // that is tied to nothing. The two cancel in the period.
    await move(ann, "2026-01-20", "income", 150_000, { billIncomeId: item.id });
    await move(ann, "2026-01-20", "expense", 150_000, { name: "Check to the tax office" });
    expect((await current(ann)).totals.projectedCents).toBe(setAside);
    expect(await totalsOf(ann, item.id)).toEqual({
      count: 4,
      paidCents: 0,
      upcomingCents: 0,
      paidOutCents: 150_000,
      paidInCents: 150_000,
      balanceCents: 0,
    });
  });

  it("counts only what has been paid toward the balance", async () => {
    const item = await addItem(ann, taxes());
    await move(ann, "2026-01-14", "expense", 40_000, { billIncomeId: item.id });
    await move(ann, "2026-01-22", "expense", 10_000, { billIncomeId: item.id, paid: false });
    await move(ann, "2026-01-23", "income", 5_000, { billIncomeId: item.id, paid: false });

    expect(await totalsOf(ann, item.id)).toEqual({
      count: 3,
      paidCents: -40_000,
      upcomingCents: -5_000,
      paidOutCents: 40_000,
      paidInCents: 0,
      balanceCents: 40_000,
    });
  });

  it("starts from what the account already held", async () => {
    const savings = await addItem(ann, taxes({ openingCents: 250_000 }));
    expect(savings.openingCents).toBe(250_000);
    await move(ann, "2026-01-14", "expense", 40_000, { billIncomeId: savings.id });
    await move(ann, "2026-01-15", "income", 100_000, { billIncomeId: savings.id });
    expect((await totalsOf(ann, savings.id)).balanceCents).toBe(190_000);
  });

  it("holds a loan as a negative balance: paying it down raises it, drawing on it lowers it", async () => {
    const heloc = await addItem(ann, taxes({ name: "HELOC", openingCents: -1_000_000 }));
    await move(ann, "2026-01-14", "expense", 20_000, { billIncomeId: heloc.id });
    expect((await totalsOf(ann, heloc.id)).balanceCents).toBe(-980_000);
    await move(ann, "2026-01-15", "income", 50_000, { billIncomeId: heloc.id });
    expect((await totalsOf(ann, heloc.id)).balanceCents).toBe(-1_030_000);
  });

  it("moves no money in any period when the starting balance is set or changed", async () => {
    const before = await startings();
    const item = await addItem(ann, taxes({ openingCents: 250_000 }));
    const patched = await ann.patch(`/api/bills-income/${item.id}`, { openingCents: -75_000 });
    expect((await patched.json()).item.openingCents).toBe(-75_000);
    expect(await startings()).toEqual(before);
    expect((await totalsOf(ann, item.id)).balanceCents).toBe(-75_000);
  });

  it("on a schedule adds money-out entries, in periods that exist and in new ones", async () => {
    const before = await startings();
    const item = await addItem(
      ann,
      taxes({ defaultAmountCents: 20_000, recurrenceUnit: "period", firstDueDate: "2026-01-13" }),
    );

    // P2, P3 and P4 each get one on their first day.
    const added = await transactionsOf(item.id);
    expect(added.map((transaction) => [transaction.occursAt, transaction.amountCents, transaction.status])).toEqual([
      ["2026-01-13T00:00", -20_000, "upcoming"],
      ["2026-01-27T00:00", -20_000, "upcoming"],
      ["2026-02-10T00:00", -20_000, "upcoming"],
    ]);
    const after = await startings();
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).toBe(before[3]! - 20_000);
    expect(after[4]).toBe(before[4]! - 40_000);

    // A period generated later gets its own.
    expect((await ann.post("/api/periods/locate", { date: "2026-02-25" })).status).toBe(200);
    expect((await transactionsOf(item.id)).at(-1)).toMatchObject({ occursAt: "2026-02-24T00:00", amountCents: -20_000 });

    const preview = await ann.post("/api/bills-income/preview", taxes({ defaultAmountCents: 20_000, recurrenceUnit: "period", firstDueDate: "2026-01-13" }));
    expect(await preview.json()).toMatchObject({ transactions: 4, periods: 4 });
  });

  it("lets money out be paid toward its scheduled entry, but not money coming back", async () => {
    const item = await addItem(
      ann,
      taxes({ defaultAmountCents: 20_000, recurrenceUnit: "month", firstDueDate: "2026-01-20" }),
    );
    const [entry] = await transactionsOf(item.id);

    const back = await ann.post("/api/transactions", {
      name: "From savings",
      amountCents: 5_000,
      kind: "income",
      occursAt: "2026-01-19T00:00",
      paid: true,
      countsToward: entry!.id,
    });
    expect(await refusedFields(back)).toEqual({
      countsToward: "Money out can't count toward money coming in, or the other way round",
    });

    await move(ann, "2026-01-19", "expense", 5_000, { countsToward: entry!.id });
    // January's entry is down to $150; February's $200 is untouched.
    expect(await totalsOf(ann, item.id)).toMatchObject({ paidOutCents: 5_000, upcomingCents: -35_000, balanceCents: 5_000 });
  });
});

describe("what kind an item is", () => {
  it("refuses a kind it does not know", async () => {
    const fields = await refusedFields(await ann.post("/api/bills-income", taxes({ kind: "savings" })));
    expect(Object.keys(fields)).toEqual(["kind"]);
  });

  it("gives a starting balance only to a transfer", async () => {
    const onCreate = await ann.post("/api/bills-income", taxes({ kind: "expense", openingCents: 100 }));
    expect(await refusedFields(onCreate)).toEqual({ openingCents: "Only a transfer has a starting balance" });

    const rent = await addItem(ann, taxes({ name: "Rent", kind: "expense" }));
    expect(rent.openingCents).toBe(0);
    const onPatch = await ann.patch(`/api/bills-income/${rent.id}`, { openingCents: 100 });
    expect(await refusedFields(onPatch)).toEqual({ openingCents: "Only a transfer has a starting balance" });

    // A transfer that holds one cannot become a bill until it is given up...
    const savings = await addItem(ann, taxes({ openingCents: 250_000 }));
    const kept = await ann.patch(`/api/bills-income/${savings.id}`, { kind: "expense" });
    expect(await refusedFields(kept)).toEqual({ openingCents: "Only a transfer has a starting balance" });
    // ...in the same change, if wanted.
    const givenUp = await ann.patch(`/api/bills-income/${savings.id}`, { kind: "expense", openingCents: 0 });
    expect((await givenUp.json()).item).toMatchObject({ kind: "expense", openingCents: 0 });
  });

  it("has no balance for a bill or an income, though the two directions are still told apart", async () => {
    const card = await addItem(ann, taxes({ name: "Credit card", kind: "expense" }));
    await move(ann, "2026-01-14", "expense", 20_000, { billIncomeId: card.id });
    await move(ann, "2026-01-16", "income", 3_000, { billIncomeId: card.id, name: "Refund" });
    expect(await totalsOf(ann, card.id)).toEqual({
      count: 2,
      paidCents: -17_000,
      upcomingCents: 0,
      paidOutCents: 20_000,
      paidInCents: 3_000,
      balanceCents: null,
    });
  });

  it("turns a bill that was really a savings account into a transfer, keeping everything tied to it", async () => {
    // Set up before transfers existed: a scheduled bill, with payments tied to it.
    const bill = await addItem(ann, {
      name: "Joint account",
      kind: "expense",
      defaultAmountCents: 30_000,
      recurrenceUnit: "month",
      firstDueDate: "2026-01-20",
    });
    await move(ann, "2026-01-14", "expense", 12_000, { billIncomeId: bill.id });
    const tiedBefore = (await transactionsOf(bill.id)).map((transaction) => [transaction.id, transaction.amountCents, transaction.status]);
    const startingsBefore = await startings();
    expect((await totalsOf(ann, bill.id)).balanceCents).toBeNull();

    const response = await ann.patch(`/api/bills-income/${bill.id}`, { kind: "transfer", openingCents: 500_000 });
    expect(response.status).toBe(200);
    expect((await response.json()).item).toMatchObject({
      kind: "transfer",
      openingCents: 500_000,
      recurrenceUnit: "month",
      defaultAmountCents: 30_000,
    });

    // Nothing that exists is touched: same transactions, same amounts, same starting amounts.
    expect((await transactionsOf(bill.id)).map((transaction) => [transaction.id, transaction.amountCents, transaction.status])).toEqual(tiedBefore);
    expect(await startings()).toEqual(startingsBefore);
    // The balance is there at once, from what was already tied.
    expect(await totalsOf(ann, bill.id)).toMatchObject({ count: 3, paidOutCents: 12_000, balanceCents: 512_000 });

    // And its schedule goes on adding money out.
    expect((await ann.post("/api/periods/locate", { date: "2026-03-22" })).status).toBe(200);
    expect((await transactionsOf(bill.id)).at(-1)).toMatchObject({ occursAt: "2026-03-20T00:00", amountCents: -30_000 });
  });

  it("keeps a transfer to its owner", async () => {
    const item = await addItem(ann, taxes({ openingCents: 250_000 }));
    const bob = await signUp("bob");

    const unknown = await bob.get("/api/bills-income/no-such-id/transactions");
    const someoneElses = await bob.get(`/api/bills-income/${item.id}/transactions`);
    expect(someoneElses.status).toBe(404);
    expect(await someoneElses.json()).toEqual(await unknown.json());

    expect((await bob.patch(`/api/bills-income/${item.id}`, { openingCents: 0 })).status).toBe(404);
    expect(((await (await bob.get("/api/bills-income")).json()).items as BillOrIncome[]).length).toBe(0);
    // Bob cannot tie his own transaction to it either, and is told no more than for an id that does not exist.
    const tied = await bob.post("/api/transactions", {
      name: "To savings",
      amountCents: 1_000,
      kind: "expense",
      occursAt: "2026-01-14T00:00",
      billIncomeId: item.id,
    });
    expect(await refusedFields(tied)).toEqual({ billIncomeId: "No such bill or income" });
    expect((await totalsOf(ann, item.id)).balanceCents).toBe(250_000);
  });
});
