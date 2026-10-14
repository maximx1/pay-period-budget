import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TransactionSearchResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
let t: TestApp;
let ann: Client;
let bob: Client;
let groceries: string;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

async function add(client: Client, name: string, date: string, overrides: Row = {}): Promise<string> {
  const response = await client.post("/api/transactions", {
    name,
    amountCents: 1_000,
    kind: "expense",
    occursAt: `${date}T00:00`,
    paid: true,
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction.id;
}

async function search(client: Client, query: Record<string, string>): Promise<TransactionSearchResponse> {
  const response = await client.get(`/api/transactions/search?${new URLSearchParams(query)}`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

const names = async (client: Client, query: Record<string, string>) =>
  (await search(client, query)).transactions.map((tx) => tx.name);

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  bob = await signUp("bob");
  groceries = (await (await ann.post("/api/categories", { name: "Groceries" })).json()).category.id;

  await add(ann, "Kroger #512", "2025-12-20", { amountCents: 5_000, categoryId: groceries });
  await add(ann, "Coffee", "2026-01-05", { amountCents: 450, note: "at KROGER fuel centre" });
  await add(ann, "KROGER fuel", "2026-01-14", { amountCents: 4_000 });
  await add(ann, "Paycheck", "2026-01-13", { amountCents: 200_000, kind: "income" });
  await add(ann, "kroger refund", "2026-01-20", { amountCents: 700, kind: "income", categoryId: groceries });
  await add(ann, "Aldi", "2026-02-11", { amountCents: 3_000, categoryId: groceries, paid: false });
  await add(ann, "100% juice_bar", "2026-01-21", { amountCents: 600 });
  await add(bob, "Kroger (Bob's)", "2026-01-14", { amountCents: 9_900 });
});
afterEach(() => t.cleanup());

describe("searching transactions", () => {
  it("finds a word anywhere in the name or the note, whatever its capitals, across every period, newest first", async () => {
    const found = await search(ann, { q: "kroger" });
    expect(found.transactions.map((tx) => tx.name)).toEqual(["kroger refund", "KROGER fuel", "Coffee", "Kroger #512"]);
    expect(found.totals).toEqual({ count: 4, outCents: 9_450, inCents: 700 });
    expect(found.nextCursor).toBeNull();

    expect(await names(ann, { q: "  KROGER  " })).toHaveLength(4);
    expect(await names(ann, { q: "oger fu" })).toEqual(["KROGER fuel", "Coffee"]);
    expect(await names(ann, { q: "nothing like it" })).toEqual([]);
    expect((await search(ann, { q: "nothing like it" })).totals).toEqual({ count: 0, outCents: 0, inCents: 0 });
  });

  it("takes the text as it is typed: % and _ are not wildcards", async () => {
    expect(await names(ann, { q: "100%" })).toEqual(["100% juice_bar"]);
    expect(await names(ann, { q: "juice_bar" })).toEqual(["100% juice_bar"]);
    expect(await names(ann, { q: "%" })).toEqual(["100% juice_bar"]);
    expect(await names(ann, { q: "_" })).toEqual(["100% juice_bar"]);
    expect(await names(ann, { q: "k_oger" })).toEqual([]);
  });

  it("can be limited to a span of days, either end of which may be left open", async () => {
    expect(await names(ann, { q: "kroger", from: "2026-01-05", to: "2026-01-14" })).toEqual(["KROGER fuel", "Coffee"]);
    expect(await names(ann, { q: "kroger", from: "2026-01-14" })).toEqual(["kroger refund", "KROGER fuel"]);
    expect(await names(ann, { q: "kroger", to: "2026-01-05" })).toEqual(["Coffee", "Kroger #512"]);
    // Dates alone are a search too.
    expect(await names(ann, { from: "2026-01-13", to: "2026-01-14" })).toEqual(["KROGER fuel", "Paycheck"]);
  });

  it("can be limited to a category, or to what has none, with or without text", async () => {
    expect(await names(ann, { categoryId: groceries })).toEqual(["Aldi", "kroger refund", "Kroger #512"]);
    expect((await search(ann, { categoryId: groceries })).totals).toEqual({ count: 3, outCents: 8_000, inCents: 700 });
    expect(await names(ann, { categoryId: groceries, q: "kroger" })).toEqual(["kroger refund", "Kroger #512"]);
    expect(await names(ann, { categoryId: "none", q: "kroger" })).toEqual(["KROGER fuel", "Coffee"]);
    expect(await names(ann, { categoryId: "none" })).toEqual(["100% juice_bar", "KROGER fuel", "Paycheck", "Coffee"]);
    expect(await names(ann, { categoryId: "no-such-category" })).toEqual([]);
  });

  it("pages through the results without skipping or repeating, the totals staying over all of them", async () => {
    for (let n = 0; n < 7; n++) await add(ann, `Bus fare ${n}`, "2026-01-16");

    for (const limit of [1, 2, 3, 7, 8]) {
      const seen: string[] = [];
      let before: string | null | undefined;
      do {
        const page: TransactionSearchResponse = await search(ann, { q: "bus", limit: String(limit), ...(before && { before }) });
        expect(page.totals.count).toBe(7);
        expect(page.transactions.length).toBeLessThanOrEqual(limit);
        seen.push(...page.transactions.map((tx) => tx.name));
        before = page.nextCursor;
      } while (before);
      expect(seen.sort(), `page size ${limit}`).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => `Bus fare ${n}`));
    }
  });

  it("refuses a search with nothing to look for, and bad dates and page sizes", async () => {
    const fieldsOf = async (query: Record<string, string>) => {
      const response = await ann.get(`/api/transactions/search?${new URLSearchParams(query)}`);
      expect(response.status).toBe(400);
      return (await response.json()).error.fields as Record<string, string>;
    };
    expect(await fieldsOf({})).toEqual({ q: "Enter something to search for, or choose a category or dates" });
    expect(await fieldsOf({ q: "   " })).toHaveProperty("q");
    expect(await fieldsOf({ q: "x", from: "2026-02-01", to: "2026-01-01" })).toEqual({ to: "The end date is before the start date" });
    expect(await fieldsOf({ q: "x", from: "soon" })).toHaveProperty("from");
    expect(await fieldsOf({ q: "x", limit: "101" })).toHaveProperty("limit");
    expect(await fieldsOf({ q: "x", before: "nonsense" })).toHaveProperty("before");
    expect(await fieldsOf({ q: "x".repeat(101) })).toHaveProperty("q");
  });

  it("changes nothing: no period is created by searching far ahead or far back", async () => {
    const before = (await (await ann.get("/api/periods")).json()).periods.length;
    await search(ann, { q: "kroger", from: "2020-01-01", to: "2030-01-01" });
    expect((await (await ann.get("/api/periods")).json()).periods.length).toBe(before);
  });

  it("only ever finds the searcher's own transactions", async () => {
    expect(await names(bob, { q: "kroger" })).toEqual(["Kroger (Bob's)"]);
    expect((await search(bob, { q: "kroger" })).totals).toEqual({ count: 1, outCents: 9_900, inCents: 0 });
    expect(await names(bob, { categoryId: groceries })).toEqual([]);
    expect((await search(ann, { q: "bob" })).totals.count).toBe(0);
    expect((await t.client().get("/api/transactions/search?q=kroger")).status).toBe(401);
  });
});
