import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecurringTransactionsResponse } from "../../shared/recurring.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// The credit card ($200 on the 5th of each month from January) is generated in P1 (Jan 5)
// and P3 (Feb 5).
let t: TestApp;
let ann: Client;
let cardId: string;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

async function addItem(client: Client, overrides: Row = {}): Promise<string> {
  const response = await client.post("/api/recurring", {
    name: "Credit card",
    kind: "expense",
    defaultAmountCents: 20_000,
    recurrenceUnit: "month",
    recurrenceInterval: 1,
    firstDueDate: "2026-01-05",
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item.id;
}

async function pay(client: Client, date: string, amountCents: number, overrides: Row = {}): Promise<string> {
  const response = await client.post("/api/transactions", {
    name: `Extra ${amountCents / 100}`,
    amountCents,
    kind: "expense",
    occursAt: `${date}T00:00`,
    paid: true,
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction.id;
}

async function page(client: Client, id: string, query = ""): Promise<RecurringTransactionsResponse> {
  const response = await client.get(`/api/recurring/${id}/transactions${query}`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  cardId = await addItem(ann);
});
afterEach(() => t.cleanup());

describe("a recurring item's transactions", () => {
  it("lists the scheduled entries and the extra payments tied to it, newest first, with totals", async () => {
    // The owner's case: $200 on the 5th by itself, then $25, $35 and $100 on top.
    await pay(ann, "2026-01-09", 2500, { recurringId: cardId });
    await pay(ann, "2026-01-16", 3500, { recurringId: cardId });
    await pay(ann, "2026-01-23", 10_000, { recurringId: cardId });
    // Not the card's: another item's entry, and a payment tied to nothing.
    await addItem(ann, { name: "Rent", defaultAmountCents: 90_000, firstDueDate: "2026-01-25" });
    await pay(ann, "2026-01-20", 777);

    const result = await page(ann, cardId);
    expect(result.transactions.map((tx) => [tx.occursAt, tx.name, tx.amountCents, tx.status, tx.occurrenceDate])).toEqual([
      ["2026-02-05T00:00", "Credit card", -20_000, "upcoming", "2026-02-05"],
      ["2026-01-23T00:00", "Extra 100", -10_000, "paid", null],
      ["2026-01-16T00:00", "Extra 35", -3500, "paid", null],
      ["2026-01-09T00:00", "Extra 25", -2500, "paid", null],
      ["2026-01-05T00:00", "Credit card", -20_000, "upcoming", "2026-01-05"],
    ]);
    expect(result.transactions.every((tx) => tx.recurringId === cardId)).toBe(true);
    expect(result.totals).toEqual({ count: 5, paidCents: -16_000, upcomingCents: -40_000 });
    expect(result.nextCursor).toBeNull();
  });

  it("follows a transaction as it is tied, paid and untied", async () => {
    const id = await pay(ann, "2026-01-20", 5000);
    expect((await page(ann, cardId)).totals).toEqual({ count: 2, paidCents: 0, upcomingCents: -40_000 });

    await ann.patch(`/api/transactions/${id}`, { recurringId: cardId });
    expect((await page(ann, cardId)).totals).toEqual({ count: 3, paidCents: -5000, upcomingCents: -40_000 });

    await ann.patch(`/api/transactions/${id}`, { recurringId: null });
    expect((await page(ann, cardId)).totals.count).toBe(2);
  });

  it("is empty, with nothing owed, for an item that has produced nothing", async () => {
    const later = await addItem(ann, { name: "Insurance", firstDueDate: "2026-09-01" });
    expect(await page(ann, later)).toEqual({
      transactions: [],
      nextCursor: null,
      totals: { count: 0, paidCents: 0, upcomingCents: 0 },
    });
  });
});

describe("a page at a time", () => {
  /** Follows nextCursor to the end, returning each page's names. */
  async function allPages(limit: number) {
    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const result: RecurringTransactionsResponse = await page(
        ann,
        cardId,
        `?limit=${limit}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
      );
      pages.push(result.transactions.map((tx) => tx.name));
      expect(result.totals.count).toBe(9);
      cursor = result.nextCursor;
    } while (cursor !== null);
    return pages;
  }

  beforeEach(async () => {
    // With the two scheduled entries that makes nine. Five of them share one moment, so a
    // page boundary is bound to fall among them.
    for (const name of ["a", "b", "c", "d", "e"]) await pay(ann, "2026-01-20", 100, { name, recurringId: cardId });
    await pay(ann, "2026-01-10", 100, { name: "older", recurringId: cardId });
    await pay(ann, "2026-01-30", 100, { name: "newer", recurringId: cardId });
  });

  it.each([1, 2, 3, 4, 8, 9, 10])("returns every transaction exactly once, %i at a time", async (limit) => {
    const pages = await allPages(limit);
    const names = pages.flat();

    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(8); // "Credit card" twice: January's and February's
    expect(names.filter((name) => name === "Credit card")).toHaveLength(2);
    expect(pages.slice(0, -1).every((names) => names.length === limit)).toBe(true);
    expect(pages).toHaveLength(Math.ceil(9 / limit));

    // Newest first throughout: the dates never go back up.
    expect(names[0]).toBe("Credit card");
    expect(names[1]).toBe("newer");
    expect(names.at(-1)).toBe("Credit card");
    expect(names.at(-2)).toBe("older");
    expect(names.slice(2, 7).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("gives thirty by default and a hundred at most", async () => {
    for (let i = 0; i < 95; i++) await pay(ann, "2026-01-21", 1, { name: `bulk ${i}`, recurringId: cardId });

    const first = await page(ann, cardId);
    expect(first.transactions).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    expect(first.totals.count).toBe(104);

    const most = await page(ann, cardId, "?limit=100");
    expect(most.transactions).toHaveLength(100);
    const rest = await page(ann, cardId, `?limit=100&before=${encodeURIComponent(most.nextCursor!)}`);
    expect(rest.transactions).toHaveLength(4);
    expect(rest.nextCursor).toBeNull();
  });

  it.each([
    ["no rows", "?limit=0", "limit"],
    ["too many rows", "?limit=101", "limit"],
    ["a limit that isn't a number", "?limit=lots", "limit"],
    ["a cursor it never gave out", "?before=yesterday", "before"],
  ])("refuses a request for %s", async (_label, query, field) => {
    const response = await ann.get(`/api/recurring/${cardId}/transactions${query}`);
    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).error.fields)).toEqual([field]);
  });
});

describe("who may read them", () => {
  it("requires signing in", async () => {
    expect((await t.client().get(`/api/recurring/${cardId}/transactions`)).status).toBe(401);
  });

  it("answers 404 for an item that does not exist and for someone else's alike", async () => {
    await pay(ann, "2026-01-20", 100, { recurringId: cardId });
    const bob = await signUp("bob");

    const unknown = await bob.get("/api/recurring/no-such-id/transactions");
    const someoneElses = await bob.get(`/api/recurring/${cardId}/transactions`);
    expect(unknown.status).toBe(404);
    expect(someoneElses.status).toBe(404);
    expect(await someoneElses.json()).toEqual(await unknown.json());
  });

  it("never mixes in another user's transactions", async () => {
    const bob = await signUp("bob");
    const bobsCard = await addItem(bob);
    await pay(bob, "2026-01-20", 4200, { recurringId: bobsCard });

    expect((await page(ann, cardId)).totals).toEqual({ count: 2, paidCents: 0, upcomingCents: -40_000 });
    expect((await page(bob, bobsCard)).totals).toEqual({ count: 3, paidCents: -4200, upcomingCents: -40_000 });
  });

  it("can be read with a read-only API token", async () => {
    const { secret } = await (await ann.post("/api/auth/tokens", { name: "Reader", scope: "read" })).json();
    const response = await t.client().get(`/api/recurring/${cardId}/transactions`, { authorization: `Bearer ${secret}` });
    expect(response.status).toBe(200);
    expect((await response.json()).totals.count).toBe(2);
  });
});
