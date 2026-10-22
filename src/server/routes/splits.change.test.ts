import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { SplitChangeResponse, SplitSummary, TransactionSplitResponse, WaitingSplitsResponse } from "../../shared/split.ts";
import type { Transaction } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// Rounding up, and changing a split once it is made: adding to it and skipping a payment.
// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16 gives:
//   P2 2026-01-13..01-26 (current)  P3 01-27..02-09  P4 02-10..02-23  P5 02-24..03-09
//   P6 03-10..03-23  P7 03-24..04-06  P8 04-07..04-20  P9 04-21..05-04  P10 05-05..05-18
const OPENING = 100_000;
const DAY = 24 * 60 * 60 * 1000;

let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Body = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  const setup = await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: OPENING, timezone: "UTC" });
  expect(setup.status).toBe(201);
  return client;
}

const item = (amountCents: number, dueDate: string, label = "") => ({ label, amountCents, dueDate });

async function split(client: Client, overrides: Body = {}) {
  const response = await client.post("/api/transactions/split", {
    name: "PayPal",
    kind: "expense",
    occursAt: "2026-01-15T09:00",
    // Due in P5: four payments of $250.
    items: [item(100_000, "2026-03-05")],
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as TransactionSplitResponse;
}

async function change(client: Client, path: string, body: Body, status = 200) {
  const response = await client.post(path, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(status);
  return (await response.json()) as SplitChangeResponse & { error: { message: string; fields?: Record<string, string> } };
}

const skip = (client: Client, splitId: string, transactionId: string, extra: Body = {}, status?: number) =>
  change(client, `/api/splits/${splitId}/skip`, { transactionId, ...extra }, status);
const addTo = (client: Client, splitId: string, body: Body, status?: number) => change(client, `/api/splits/${splitId}/items`, body, status);

const listed = async (client: Client, from = "2026-01-01", to = "2026-12-31") =>
  ((await (await client.get(`/api/transactions?from=${from}&to=${to}`)).json()) as { transactions: Transaction[] }).transactions;
const amounts = (transactions: Transaction[]) => transactions.map(({ occursAt, amountCents }) => [occursAt, amountCents]);
const splits = async (client: Client) => ((await (await client.get("/api/splits")).json()) as WaitingSplitsResponse).splits;

/** What a later period starts with: every transaction before it carried forward. */
async function startingOn(client: Client, date: string) {
  const { periodId } = (await (await client.post("/api/periods/locate", { date })).json()) as { periodId: string };
  return ((await (await client.get(`/api/periods/${periodId}`)).json()) as PeriodView).period.startingCents;
}

async function markPaid(client: Client, id: string, patch: Body = {}) {
  const response = await client.patch(`/api/transactions/${id}`, { status: "paid", ...patch });
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("rounding up", () => {
  it("rounds each payment up to $50 and drops the payments the extra covers", async () => {
    // $975.30 over six periods, P2 to P7, would be $162.55 each.
    const result = await split(ann, { roundUp: true, items: [item(97_530, "2026-04-01")] });
    expect(result.payments.map(({ occursAt, amountCents }) => [occursAt, amountCents])).toEqual([
      ["2026-01-15T09:00", -20_000],
      ["2026-01-27T00:00", -20_000],
      ["2026-02-10T00:00", -20_000],
      ["2026-02-24T00:00", -20_000],
      ["2026-03-10T00:00", -17_530],
    ]);
    expect(amounts(await listed(ann))).toEqual(result.payments.map(({ occursAt, amountCents }) => [occursAt, amountCents]));
  });

  it("rounds a period's total, not each item in it", async () => {
    const result = await split(ann, {
      roundUp: true,
      // $12 a period each over four periods, P2 to P5.
      items: [item(4_800, "2026-03-05", "Shoes"), item(4_800, "2026-03-05", "Coat"), item(4_800, "2026-03-05", "Hat")],
    });
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([-5_000, -5_000, -4_400]);
    expect((await listed(ann)).map((transaction) => transaction.note)).toEqual([
      "Shoes $26.00 + Coat $12.00 + Hat $12.00",
      "Shoes $22.00 + Coat $16.00 + Hat $12.00",
      "Coat $20.00 + Hat $24.00",
    ]);
  });

  it("is off unless asked for", async () => {
    const result = await split(ann, { items: [item(97_530, "2026-04-01")] });
    expect(result.payments.map((payment) => payment.amountCents)).toEqual(Array(6).fill(-16_255));
  });
});

describe("keeping the split", () => {
  it("ties its transactions to it and lists it while anything is unpaid", async () => {
    const result = await split(ann);
    const saved = await listed(ann);
    expect(saved.every((transaction) => transaction.splitId === result.splitId)).toBe(true);

    await markPaid(ann, saved[0]!.id);
    expect(await splits(ann)).toEqual<SplitSummary[]>([
      {
        id: result.splitId!,
        name: "PayPal",
        kind: "expense",
        editable: true,
        roundUp: false,
        finishEarly: false,
        totalCents: 0,
        payments: [],
        inReach: 0,
        remind: false,
        items: [{ id: expect.any(String), label: "", amountCents: 100_000, dueDate: "2026-03-05", leftCents: 75_000 }],
        upcoming: saved.slice(1).map(({ id, occursAt, amountCents, note }) => ({ id, occursAt, amountCents, note })),
        paidCents: 25_000,
      },
    ]);

    for (const transaction of saved.slice(1)) await markPaid(ann, transaction.id);
    expect(await splits(ann)).toEqual([]);
  });

  it("lists another user's splits to no one else", async () => {
    await split(ann);
    expect(await splits(await signUp("bob"))).toEqual([]);
  });
});

describe("skipping a payment", () => {
  it("spreads what it held over the payments after it, and leaves the ones before it alone", async () => {
    const { splitId } = await split(ann);
    const before = await listed(ann);
    const startingAfter = await startingOn(ann, "2026-03-10");

    const result = await skip(ann, splitId!, before[1]!.id);
    expect(result.skipped).toEqual({ occursAt: "2026-01-27T00:00", amountCents: -25_000 });
    expect(result.payments.map(({ occursAt, amountCents }) => [occursAt, amountCents])).toEqual([
      ["2026-02-10T00:00", -37_500],
      ["2026-02-24T00:00", -37_500],
    ]);
    const after = await listed(ann);
    expect(amounts(after)).toEqual([
      ["2026-01-15T09:00", -25_000],
      ["2026-02-10T00:00", -37_500],
      ["2026-02-24T00:00", -37_500],
    ]);
    // The same transactions, changed in place.
    expect(after.slice(1).map((transaction) => transaction.id)).toEqual(before.slice(2).map((transaction) => transaction.id));
    // The same total, so what comes after starts with the same.
    expect(await startingOn(ann, "2026-03-10")).toBe(startingAfter);
    expect(await startingOn(ann, "2026-01-27")).toBe(OPENING - 25_000);
    expect(await startingOn(ann, "2026-02-10")).toBe(OPENING - 25_000);
  });

  it("only says what it would do on a dry run", async () => {
    const { splitId } = await split(ann);
    const before = await listed(ann);
    const preview = await skip(ann, splitId!, before[1]!.id, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.payments.map((payment) => payment.amountCents)).toEqual([-37_500, -37_500]);
    expect(await listed(ann)).toEqual(before);
  });

  it("stays skipped when the split is worked out again later", async () => {
    const { splitId } = await split(ann);
    const [, second, third] = await listed(ann);
    await skip(ann, splitId!, third!.id);
    // P4 is skipped; now P3 too. Only P2 and P5 are left.
    await skip(ann, splitId!, second!.id);
    expect(amounts(await listed(ann))).toEqual([
      ["2026-01-15T09:00", -25_000],
      ["2026-02-24T00:00", -75_000],
    ]);
  });

  it("works out the payments still waiting again too", async () => {
    // P2 to P37, 100 cents each; P29 on wait, being more than a year ahead.
    const { splitId } = await split(ann, { items: [item(3_600, "2027-05-31")] });
    const [, second] = await listed(ann);
    const result = await skip(ann, splitId!, second!.id);
    // P2's 100 stays; the other 3,500 is spread over P4 to P37, nine of those still waiting.
    expect(result.later).toHaveLength(9);
    expect([...result.payments, ...result.later].reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(-3_500);
    const [listedSplit] = await splits(ann);
    expect(listedSplit!.payments.map((payment) => payment.amountCents)).toEqual(result.later.map((payment) => payment.amountCents));
    expect(listedSplit!.items![0]!.leftCents).toBe(3_600);
  });

  it("refuses the last payment before an item is due", async () => {
    const { splitId } = await split(ann);
    const before = await listed(ann);
    const { error } = await skip(ann, splitId!, before.at(-1)!.id, {}, 409);
    expect(error.message).toBe("That's the last payment before PayPal is due on Mar 5, 2026, so it can't be skipped");
    expect(await listed(ann)).toEqual(before);
  });

  it("refuses a paid payment", async () => {
    const { splitId } = await split(ann);
    const [first] = await listed(ann);
    await markPaid(ann, first!.id);
    expect((await skip(ann, splitId!, first!.id, {}, 409)).error.message).toBe("That payment is already paid");
  });

  it("keeps rounding up after a skip", async () => {
    const { splitId } = await split(ann, { roundUp: true, items: [item(97_530, "2026-04-01")] });
    const before = await listed(ann);
    await skip(ann, splitId!, before[1]!.id);
    // $775.30 left over P4 to P7: $193.83 each, rounded to $200.
    expect(amounts(await listed(ann))).toEqual([
      ["2026-01-15T09:00", -20_000],
      ["2026-02-10T00:00", -20_000],
      ["2026-02-24T00:00", -20_000],
      ["2026-03-10T00:00", -20_000],
      ["2026-03-24T00:00", -17_530],
    ]);
  });

  it("counts a paid payment for what it came to when it was changed by hand", async () => {
    const { splitId } = await split(ann);
    const [first, second] = await listed(ann);
    await markPaid(ann, first!.id, { amountCents: 40_000 });
    await skip(ann, splitId!, second!.id);
    expect(amounts(await listed(ann))).toEqual([
      ["2026-01-15T09:00", -40_000],
      ["2026-02-10T00:00", -30_000],
      ["2026-02-24T00:00", -30_000],
    ]);
  });

  it("is a 404 for a transaction that isn't the split's, or a split that isn't the user's", async () => {
    const { splitId } = await split(ann);
    const [first] = await listed(ann);
    const other = await split(ann, { name: "Other" });
    await skip(ann, other.splitId!, first!.id, {}, 404);

    const bob = await signUp("bob");
    await skip(bob, splitId!, first!.id, {}, 404);
    await addTo(bob, splitId!, { occursAt: "2026-01-15T10:00", items: [item(1_000, "2026-03-05", "Hat")] }, 404);
    expect((await listed(ann)).filter((transaction) => transaction.splitId === splitId)).toHaveLength(4);
  });
});

describe("adding to a split", () => {
  it("works out the unpaid payments again with the new item, from its first payment on", async () => {
    // $600 over P2 to P7, $100 each. Two are paid, and it is now P4.
    const { splitId } = await split(ann, { items: [item(60_000, "2026-04-01")] });
    const [first, second] = await listed(ann);
    await markPaid(ann, first!.id);
    await markPaid(ann, second!.id);
    t.clock.advance(28 * DAY); // 2026-02-12, in P4

    const result = await addTo(ann, splitId!, { occursAt: "2026-02-12T08:00", items: [item(40_000, "2026-05-15", "Couch")] });
    // PayPal: $400 left over P4 to P7. Couch: $400 over P4 to P10 (due in P10, May 5 to 18).
    expect(result.labels).toEqual(["PayPal", "Couch"]);
    expect(result.payments.map(({ occursAt, amountCents, shares }) => [occursAt, amountCents, shares])).toEqual([
      ["2026-02-10T00:00", -15_715, [{ item: 0, cents: 10_000 }, { item: 1, cents: 5_715 }]],
      ["2026-02-24T00:00", -15_715, [{ item: 0, cents: 10_000 }, { item: 1, cents: 5_715 }]],
      ["2026-03-10T00:00", -15_714, [{ item: 0, cents: 10_000 }, { item: 1, cents: 5_714 }]],
      ["2026-03-24T00:00", -15_714, [{ item: 0, cents: 10_000 }, { item: 1, cents: 5_714 }]],
      ["2026-04-07T00:00", -5_714, [{ item: 1, cents: 5_714 }]],
      ["2026-04-21T00:00", -5_714, [{ item: 1, cents: 5_714 }]],
      ["2026-05-05T00:00", -5_714, [{ item: 1, cents: 5_714 }]],
    ]);
    const saved = await listed(ann);
    expect(saved.slice(0, 2).map(({ id, amountCents, status, note }) => ({ id, amountCents, status, note }))).toEqual([
      { id: first!.id, amountCents: -10_000, status: "paid", note: null },
      { id: second!.id, amountCents: -10_000, status: "paid", note: null },
    ]);
    expect(saved.slice(2).map(({ amountCents, note, splitId: tie }) => [amountCents, note, tie === splitId])).toEqual([
      [-15_715, "PayPal $100.00 + Couch $57.15", true],
      [-15_715, "PayPal $100.00 + Couch $57.15", true],
      [-15_714, "PayPal $100.00 + Couch $57.14", true],
      [-15_714, "PayPal $100.00 + Couch $57.14", true],
      [-5_714, "Couch $57.14", true],
      [-5_714, "Couch $57.14", true],
      [-5_714, "Couch $57.14", true],
    ]);
    const [listedSplit] = await splits(ann);
    expect(listedSplit!.items!.map(({ label, leftCents }) => [label, leftCents])).toEqual([
      ["PayPal", 40_000],
      ["Couch", 40_000],
    ]);
  });

  it("dates a new payment in the first payment's period at the time asked for", async () => {
    // Due in P3, finished early would be P2 only: a single payment.
    const { splitId } = await split(ann, { items: [item(10_000, "2026-01-20")] });
    const [only] = await listed(ann);
    await markPaid(ann, only!.id);
    // P2's payment is paid, so the new item starts in P3.
    const result = await addTo(ann, splitId!, { occursAt: "2026-01-16T10:30", items: [item(5_000, "2026-02-12", "Hat")] });
    expect(result.payments.map(({ occursAt, amountCents }) => [occursAt, amountCents])).toEqual([
      ["2026-01-27T00:00", -2_500],
      ["2026-02-10T00:00", -2_500],
    ]);

    const fresh = await split(ann, { name: "Fresh", occursAt: "2026-01-27T00:00", items: [item(10_000, "2026-02-12")] });
    const added = await addTo(ann, fresh.splitId!, { occursAt: "2026-02-11T10:30", items: [item(1_000, "2026-02-12", "Hat")] });
    // P4 already has an unpaid payment: it grows and keeps its date.
    expect(added.payments.map(({ occursAt, amountCents }) => [occursAt, amountCents])).toEqual([["2026-02-10T00:00", -6_000]]);
  });

  it("can turn rounding up on as it goes", async () => {
    const { splitId } = await split(ann, { items: [item(60_000, "2026-04-01")] });
    const result = await addTo(ann, splitId!, { occursAt: "2026-01-15T09:00", roundUp: true, items: [item(10_000, "2026-04-01", "Hat")] });
    // $700 over six periods would be $116.67: $150 each, then $100.
    expect(result.payments.map((payment) => payment.amountCents)).toEqual([-15_000, -15_000, -15_000, -15_000, -10_000]);
    expect((await splits(ann))[0]!.roundUp).toBe(true);
  });

  it("refuses a due date before the new first payment, and more than ten items", async () => {
    const { splitId } = await split(ann);
    const early = await addTo(ann, splitId!, { occursAt: "2026-02-12T08:00", items: [item(1_000, "2026-02-01", "Hat")] }, 400);
    expect(early.error.fields).toEqual({ "items.0.dueDate": "That's before the first payment" });
    const many = Array.from({ length: 10 }, (_, index) => item(1_000, "2026-03-05", `Thing ${index}`));
    expect((await addTo(ann, splitId!, { occursAt: "2026-01-15T09:00", items: many }, 400)).error.message).toBe(
      "A split holds up to 10 things; this one has 1",
    );
  });

  it("refuses a split made before splits were kept", async () => {
    const userId = (await t.store.users.findByUsername("ann"))!.id;
    await t.store.splits.create({
      id: "legacy",
      userId,
      name: "Old",
      kind: "expense",
      note: null,
      billIncomeId: null,
      categoryId: null,
      finishEarly: false,
      roundUp: false,
      skippedSeqs: [],
      createdAt: t.clock.now(),
      updatedAt: t.clock.now(),
    });
    await addTo(ann, "legacy", { occursAt: "2026-01-15T09:00", items: [item(1_000, "2026-03-05", "Hat")] }, 409);
  });
});
