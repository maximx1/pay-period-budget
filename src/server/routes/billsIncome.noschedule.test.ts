import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillOrIncome, BillOrIncomeTransactionsResponse } from "../../shared/billsIncome.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20: five periods, P2 (2026-01-13..01-26) current.
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

const sideJobs = (overrides: Row = {}): Row => ({
  name: "Side jobs",
  kind: "income",
  defaultAmountCents: 0,
  recurrenceUnit: "none",
  ...overrides,
});

async function addItem(body: Row): Promise<BillOrIncome> {
  const response = await ann.post("/api/bills-income", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

async function refusedFields(response: Response): Promise<Record<string, string>> {
  expect(response.status).toBe(400);
  return (await response.json()).error.fields;
}

const transactionCount = async () => {
  const id = (await t.store.users.findByUsername("ann"))!.id;
  return (await t.store.transactions.listInRange(id, "2025-01-01", "2027-12-31")).length;
};
const startings = async () => {
  const id = (await t.store.users.findByUsername("ann"))!.id;
  return (await t.store.periods.listAll(id)).map((period) => period.startingCents);
};

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("an item with no schedule", () => {
  it("needs no amount and no first due date, and says what it is", async () => {
    const item = await addItem(sideJobs());
    expect(item).toMatchObject({
      name: "Side jobs",
      kind: "income",
      defaultAmountCents: 0,
      recurrenceUnit: "none",
      recurrenceInterval: 1,
      // Only the day it was added: there is nothing due.
      firstDueDate: "2026-01-15",
      endDate: null,
      archived: false,
      nextDueDate: null,
      scheduleText: "As it happens",
    });

    const listed = (await (await ann.get("/api/bills-income")).json()).items as BillOrIncome[];
    expect(listed.map((each) => each.id)).toEqual([item.id]);
  });

  it("may still have a usual amount", async () => {
    expect((await addItem(sideJobs({ defaultAmountCents: 20_000 }))).defaultAmountCents).toBe(20_000);
  });

  it("adds nothing: not to the periods that exist, and not to new ones", async () => {
    const before = await startings();
    const preview = await (await ann.post("/api/bills-income/preview", sideJobs({ defaultAmountCents: 20_000 }))).json();
    expect(preview).toEqual({ transactions: 0, periods: 0, pastPeriods: 0, earliestDate: null });

    await addItem(sideJobs({ defaultAmountCents: 20_000 }));
    expect(await transactionCount()).toBe(0);
    expect(await startings()).toEqual(before);

    // Periods generated later, and added before the budget, get nothing from it either.
    expect((await ann.post("/api/periods/locate", { date: "2026-06-01" })).status).toBe(200);
    expect((await ann.post("/api/periods/earlier")).status).toBe(200);
    expect(await transactionCount()).toBe(0);
  });

  it("gathers the transactions tied to it, however far apart", async () => {
    // The owner's case: money from a friend for a day's roofing, then nothing for months.
    const item = await addItem(sideJobs());
    const earn = async (date: string, name: string, amountCents: number) => {
      const response = await ann.post("/api/transactions", {
        name,
        amountCents,
        kind: "income",
        occursAt: `${date}T00:00`,
        paid: true,
        billIncomeId: item.id,
      });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    };
    await earn("2025-12-20", "Roofing for Mike", 20_000);
    await earn("2026-01-14", "Moved a couch", 4000);
    await earn("2026-11-02", "Roofing for Mike again", 25_000);

    const result = (await (
      await ann.get(`/api/bills-income/${item.id}/transactions`)
    ).json()) as BillOrIncomeTransactionsResponse;
    expect(result.transactions.map((tx) => [tx.occursAt.slice(0, 10), tx.name, tx.amountCents])).toEqual([
      ["2026-11-02", "Roofing for Mike again", 25_000],
      ["2026-01-14", "Moved a couch", 4000],
      ["2025-12-20", "Roofing for Mike", 20_000],
    ]);
    expect(result.totals).toEqual({ count: 3, paidCents: 49_000, upcomingCents: 0, paidOutCents: 0, paidInCents: 49_000, balanceCents: null });
  });

  it("can be ended, which archives it", async () => {
    const item = await addItem(sideJobs());
    const ended = await ann.post(`/api/bills-income/${item.id}/end`, { removeUpcoming: true });
    expect(ended.status).toBe(200);
    expect((await ended.json()).item).toMatchObject({ endDate: "2026-01-15", archived: false });

    t.clock.advance(24 * 60 * 60 * 1000);
    const [listed] = (await (await ann.get("/api/bills-income")).json()).items as BillOrIncome[];
    expect(listed).toMatchObject({ archived: true, scheduleText: "As it happens" });
  });
});

describe("anything that does repeat", () => {
  const monthly = (overrides: Row = {}): Row => ({
    name: "Rent",
    kind: "expense",
    defaultAmountCents: 90_000,
    recurrenceUnit: "month",
    firstDueDate: "2026-01-25",
    ...overrides,
  });

  it("still needs an amount and a first due date", async () => {
    expect(await refusedFields(await ann.post("/api/bills-income", monthly({ defaultAmountCents: 0 })))).toEqual({
      defaultAmountCents: "Enter an amount greater than zero",
    });
    expect(await refusedFields(await ann.post("/api/bills-income", monthly({ firstDueDate: undefined })))).toEqual({
      firstDueDate: "Enter the first due date",
    });
    expect(await refusedFields(await ann.post("/api/bills-income/preview", monthly({ defaultAmountCents: 0 })))).toEqual({
      defaultAmountCents: "Enter an amount greater than zero",
    });
    expect(await refusedFields(await ann.post("/api/bills-income", monthly({ defaultAmountCents: -5 })))).toEqual({
      defaultAmountCents: "Enter an amount greater than zero",
    });
    expect(await transactionCount()).toBe(0);
  });

  it("cannot be given a schedule while it has no amount, nor lose its amount while it has one", async () => {
    const loose = await addItem(sideJobs());
    const scheduled = await ann.patch(`/api/bills-income/${loose.id}`, { recurrenceUnit: "month", firstDueDate: "2026-03-01" });
    expect(await refusedFields(scheduled)).toEqual({ defaultAmountCents: "Enter an amount greater than zero" });

    const rent = await addItem(monthly());
    const emptied = await ann.patch(`/api/bills-income/${rent.id}`, { defaultAmountCents: 0 });
    expect(await refusedFields(emptied)).toEqual({ defaultAmountCents: "Enter an amount greater than zero" });
  });

  it("can gain a schedule, or drop it, and only what is generated from then on changes", async () => {
    const loose = await addItem(sideJobs({ kind: "expense", name: "Card" }));
    const given = await ann.patch(`/api/bills-income/${loose.id}`, {
      recurrenceUnit: "month",
      firstDueDate: "2026-01-05",
      defaultAmountCents: 20_000,
    });
    expect(given.status).toBe(200);
    expect((await given.json()).item).toMatchObject({ scheduleText: "Every month on the 5th", nextDueDate: "2026-02-05" });
    // Editing never reaches into periods that exist.
    expect(await transactionCount()).toBe(0);
    expect((await ann.post("/api/periods/locate", { date: "2026-03-10" })).status).toBe(200);
    expect(await transactionCount()).toBe(1);

    const dropped = await ann.patch(`/api/bills-income/${loose.id}`, { recurrenceUnit: "none", defaultAmountCents: 0 });
    expect(dropped.status).toBe(200);
    expect((await dropped.json()).item).toMatchObject({ scheduleText: "As it happens", nextDueDate: null });
    expect((await ann.post("/api/periods/locate", { date: "2026-05-10" })).status).toBe(200);
    expect(await transactionCount()).toBe(1);
  });
});
