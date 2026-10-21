import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddWaitingResponse, TransactionSplitResponse, WaitingSplitsResponse } from "../../shared/split.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16: today is in
// P2 2026-01-13..01-26. The furthest period that may exist holds 2027-01-15:
// P28 2027-01-12..01-25. After it come P29 01-26, P30 02-09, P31 02-23, P32 03-09,
// P33 03-23, P34 04-06, P35 04-20, P36 05-04, P37 05-18..05-31. Each payday a year later
// becomes reachable: on 2026-01-27 (P3 begins) the furthest is P29, and so on.
const DAY = 24 * 60 * 60 * 1000;
const PAYDAY = 14 * DAY;

let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Body = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  const setup = await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  expect(setup.status).toBe(201);
  return client;
}

async function split(client: Client, overrides: Body = {}) {
  const response = await client.post("/api/transactions/split", {
    name: "Furniture",
    kind: "expense",
    occursAt: "2026-01-15T09:00",
    // Thirty-six periods, P2 to P37: 100 cents each. Nine of them wait.
    items: [{ label: "", amountCents: 3_600, dueDate: "2027-05-31" }],
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as TransactionSplitResponse;
}

const waiting = async (client: Client) => ((await (await client.get("/api/splits")).json()) as WaitingSplitsResponse).splits;

async function add(client: Client, id: string) {
  const response = await client.post(`/api/splits/${id}/add`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as AddWaitingResponse;
}

/** Every transaction the user has, from a store read: the API caps a range at a year. */
const allTransactions = async (name: string) =>
  t.store.transactions.listInRange((await t.store.users.findByUsername(name))!.id, "2025-01-01", "2028-12-31");

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("what a split leaves waiting", () => {
  it("keeps the payments too far ahead, exactly as worked out", async () => {
    const result = await split(ann);
    expect(result.later).toHaveLength(9);
    expect(result.waitingId).not.toBeNull();

    const [furniture, ...others] = await waiting(ann);
    expect(others).toEqual([]);
    expect(furniture).toMatchObject({ id: result.waitingId, name: "Furniture", totalCents: -900, inReach: 0, remind: false });
    expect(furniture!.payments.map(({ occursAt, amountCents, inReach }) => [occursAt, amountCents, inReach])).toEqual(
      result.later.map(({ occursAt, amountCents }) => [occursAt, amountCents, false]),
    );
  });

  it("is nothing when the whole split fits", async () => {
    const result = await split(ann, { items: [{ label: "", amountCents: 1_000, dueDate: "2026-03-05" }] });
    expect(result.waitingId).toBeNull();
    expect(await waiting(ann)).toEqual([]);
  });

  it("is not kept by a dry run", async () => {
    const preview = await split(ann, { dryRun: true });
    expect(preview.later).toHaveLength(9);
    expect(await waiting(ann)).toEqual([]);
  });

  it("keeps each item's share in the note, and the bill or income's category when none was named", async () => {
    const category = (await (await ann.post("/api/categories", { name: "Home", defaultLimitCents: null })).json()) as {
      category: { id: string };
    };
    const bill = (await (
      await ann.post("/api/bills-income", {
        name: "PayPal",
        kind: "expense",
        defaultAmountCents: 0,
        recurrenceUnit: "none",
        recurrenceInterval: 1,
        categoryId: category.category.id,
      })
    ).json()) as { item: { id: string } };
    await split(ann, {
      billIncomeId: bill.item.id,
      items: [
        { label: "Couch", amountCents: 3_600, dueDate: "2027-05-31" },
        { label: "Lamp", amountCents: 3_600, dueDate: "2027-05-31" },
      ],
    });
    const [furniture] = await waiting(ann);
    expect(furniture!.payments[0]!.note).toBe("Couch $1.00 + Lamp $1.00");

    t.clock.advance(12 * DAY);
    await add(ann, furniture!.id);
    const added = (await allTransactions("ann")).filter((transaction) => transaction.occursAt >= "2027-01-26");
    expect(added.length).toBeGreaterThan(0);
    expect(new Set(added.map((transaction) => transaction.categoryId))).toEqual(new Set([category.category.id]));
    expect(new Set(added.map((transaction) => transaction.billIncomeId))).toEqual(new Set([bill.item.id]));
  });
});

describe("the reminder", () => {
  it("waits until three payments can be added, not one each payday", async () => {
    const { waitingId } = await split(ann);
    const status = async () => {
      const [furniture] = await waiting(ann);
      return { inReach: furniture!.inReach, remind: furniture!.remind };
    };

    t.clock.advance(12 * DAY); // 2026-01-27: P29 can exist.
    expect(await status()).toEqual({ inReach: 1, remind: false });
    t.clock.advance(PAYDAY);
    expect(await status()).toEqual({ inReach: 2, remind: false });
    t.clock.advance(PAYDAY);
    expect(await status()).toEqual({ inReach: 3, remind: true });

    // Adding them starts the count again.
    const result = await add(ann, waitingId!);
    expect(result.added.map((payment) => payment.occursAt)).toEqual(["2027-01-26T00:00", "2027-02-09T00:00", "2027-02-23T00:00"]);
    expect(result.waiting).toMatchObject({ inReach: 0, remind: false, totalCents: -600 });
    t.clock.advance(PAYDAY);
    expect(await status()).toEqual({ inReach: 1, remind: false });
  });

  it("comes as soon as the rest can all be added, however few", async () => {
    await split(ann, { items: [{ label: "", amountCents: 3_000, dueDate: "2027-02-01" }] }); // P29 waits alone.
    expect((await waiting(ann))[0]).toMatchObject({ inReach: 0, remind: false });
    t.clock.advance(12 * DAY);
    expect((await waiting(ann))[0]).toMatchObject({ inReach: 1, remind: true });
  });
});

describe("adding what is waiting", () => {
  it("adds the ones in reach as the transactions worked out, and carries them like any others", async () => {
    const { waitingId, later } = await split(ann);
    t.clock.advance(12 * DAY + PAYDAY);
    const result = await add(ann, waitingId!);

    expect(result.added).toEqual(later.slice(0, 2).map(({ occursAt, amountCents }) => ({ occursAt, amountCents })));
    const saved = await allTransactions("ann");
    expect(saved.filter((transaction) => transaction.occursAt >= "2027-01-26").map((transaction) => [
      transaction.occursAt,
      transaction.amountCents,
      transaction.name,
      transaction.status,
    ])).toEqual([
      ["2027-01-26T00:00", -100, "Furniture", "upcoming"],
      ["2027-02-09T00:00", -100, "Furniture", "upcoming"],
    ]);
    expect((await waiting(ann))[0]!.payments).toHaveLength(7);
  });

  it("drops the split from the list once the last is added", async () => {
    const { waitingId } = await split(ann, { items: [{ label: "", amountCents: 3_000, dueDate: "2027-02-01" }] });
    t.clock.advance(12 * DAY);
    const result = await add(ann, waitingId!);
    expect(result.added).toHaveLength(1);
    expect(result.waiting).toBeUndefined();
    expect(await waiting(ann)).toEqual([]);
  });

  it("refuses when none can be added yet, and changes nothing", async () => {
    const { waitingId } = await split(ann);
    const before = await allTransactions("ann");
    const response = await ann.post(`/api/splits/${waitingId}/add`);
    expect(response.status).toBe(409);
    expect(await allTransactions("ann")).toEqual(before);
    expect((await waiting(ann))[0]!.payments).toHaveLength(9);
  });

  it("adds them untied when their bill or income was deleted meanwhile", async () => {
    const bill = (await (
      await ann.post("/api/bills-income", { name: "PayPal", kind: "expense", defaultAmountCents: 0, recurrenceUnit: "none", recurrenceInterval: 1 })
    ).json()) as { item: { id: string } };
    const { waitingId } = await split(ann, { billIncomeId: bill.item.id });
    expect((await ann.delete(`/api/bills-income/${bill.item.id}`)).status).toBe(204);
    t.clock.advance(12 * DAY);
    await add(ann, waitingId!);
    const added = (await allTransactions("ann")).find((transaction) => transaction.occursAt === "2027-01-26T00:00");
    expect(added?.billIncomeId).toBeNull();
  });
});

describe("cancelling what is waiting", () => {
  it("drops what has not been added and keeps what has", async () => {
    const { waitingId, payments } = await split(ann);
    expect((await ann.delete(`/api/splits/${waitingId}`)).status).toBe(204);
    expect(await waiting(ann)).toEqual([]);
    expect(await allTransactions("ann")).toHaveLength(payments.length);
    expect((await ann.delete(`/api/splits/${waitingId}`)).status).toBe(404);
  });
});

describe("whose it is", () => {
  it("requires signing in", async () => {
    const anonymous = t.client();
    expect((await anonymous.get("/api/splits")).status).toBe(401);
    expect((await anonymous.post("/api/splits/x/add")).status).toBe(401);
    expect((await anonymous.delete("/api/splits/x")).status).toBe(401);
  });

  it("never shows, adds or cancels another user's, and answers as if it did not exist", async () => {
    const bob = await signUp("bob");
    const { waitingId } = await split(ann);
    t.clock.advance(12 * DAY);

    expect(await waiting(bob)).toEqual([]);
    const adding = await bob.post(`/api/splits/${waitingId}/add`);
    const cancelling = await bob.delete(`/api/splits/${waitingId}`);
    const missing = await bob.delete("/api/splits/no-such-split");
    expect([adding.status, cancelling.status, missing.status]).toEqual([404, 404, 404]);
    expect(await cancelling.json()).toEqual(await missing.json());

    expect((await waiting(ann))[0]!.payments).toHaveLength(9);
    expect(await allTransactions("bob")).toEqual([]);
  });
});
