import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { Transaction, TransactionImportResponse, TransactionResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// Rent ($900, monthly from 2026-01-25) is generated as upcoming in P2 (Jan 25).
const OPENING = 100_000;
const RENT = 90_000;

let t: TestApp;
let ann: Client;
let rentId: string;
let cardId: string;
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

async function addItem(client: Client, overrides: Row = {}): Promise<string> {
  const response = await client.post("/api/recurring", {
    name: "Rent",
    kind: "expense",
    defaultAmountCents: RENT,
    recurrenceUnit: "month",
    recurrenceInterval: 1,
    firstDueDate: "2026-01-25",
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item.id;
}

const payment = (date: string, overrides: Row = {}): Row => ({
  name: "Payment",
  amountCents: 30_000,
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

async function refused(client: Client, body: Row): Promise<Record<string, string>> {
  const before = await everything(client);
  const response = await client.post("/api/transactions", body);
  expect(response.status).toBe(400);
  expect(await everything(client)).toEqual(before);
  return (await response.json()).error.fields;
}

const listed = async (client: Client, from = "2025-12-16", to = "2026-02-23") =>
  ((await (await client.get(`/api/transactions?from=${from}&to=${to}`)).json()) as { transactions: Transaction[] })
    .transactions;

/** Names, amounts and links of everything, for "nothing changed" comparisons. */
const everything = async (client: Client) =>
  (await listed(client)).map(({ name, amountCents, status, recurringId }) => ({ name, amountCents, status, recurringId }));

const current = async (client: Client) => (await (await client.get("/api/periods/current")).json()) as PeriodView;

const userId = async (name: string) => (await t.store.users.findByUsername(name))!.id;

/** Every automatic starting amount must equal what the period before it is projected to end with. */
async function expectChainConsistent(name = "ann") {
  const id = await userId(name);
  const periods = await t.store.periods.listAll(id);
  for (let i = 1; i < periods.length; i++) {
    const previous = periods[i - 1]!;
    const sums = await t.store.transactions.sumInRange(id, previous.startDate, previous.endDate);
    expect(periods[i]!.startingCents, `starting amount of period ${periods[i]!.seq}`).toBe(
      previous.startingCents + sums.paidCents + sums.upcomingCents,
    );
  }
  return periods.map((period) => period.startingCents);
}

const rentDue = async (client: Client = ann) =>
  (await listed(client)).find((tx) => tx.name === "Rent" && tx.occursAt === "2026-01-25T00:00");

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  rentId = await addItem(ann);
  cardId = await addItem(ann, { name: "Credit card", defaultAmountCents: 5000, firstDueDate: "2026-06-01" });
});
afterEach(() => t.cleanup());

describe("tying a transaction to a recurring item", () => {
  it("links a new transaction and changes nothing else about it", async () => {
    const plain = await signUp("bob");
    await addItem(plain);
    await create(plain, payment("2026-01-20"));

    const { transaction } = await create(ann, payment("2026-01-20", { recurringId: cardId }));
    expect(transaction).toMatchObject({ recurringId: cardId, occurrenceDate: null, amountCents: -30_000, status: "paid" });

    // Tied or not, the money moves the same way.
    expect(await expectChainConsistent("ann")).toEqual(await expectChainConsistent("bob"));
    // The bill the item generated is untouched: a link by itself pays nothing off.
    expect(await rentDue()).toMatchObject({ amountCents: -RENT, status: "upcoming", recurringId: rentId });
  });

  it("tells a generated transaction from a tied one by its occurrence date", async () => {
    await create(ann, payment("2026-01-20", { recurringId: rentId }));
    const rents = (await listed(ann)).filter((tx) => tx.recurringId === rentId);
    expect(rents.map((tx) => [tx.name, tx.occurrenceDate])).toEqual([
      ["Payment", null],
      ["Rent", "2026-01-25"],
    ]);
  });

  it("ties, moves and unties an existing transaction", async () => {
    const { transaction } = await create(ann, payment("2026-01-20"));
    const patch = async (body: Row) => {
      const response = await ann.patch(`/api/transactions/${transaction.id}`, body);
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      return ((await response.json()) as TransactionResponse).transaction;
    };

    expect((await patch({ recurringId: cardId })).recurringId).toBe(cardId);
    expect((await patch({ recurringId: rentId })).recurringId).toBe(rentId);
    // Another field changed: the link stays.
    expect((await patch({ name: "Renamed" })).recurringId).toBe(rentId);
    expect((await patch({ recurringId: null })).recurringId).toBeNull();
    await expectChainConsistent();
  });

  it("keeps a generated transaction's date when untied, and drops it when moved to another item", async () => {
    const rent = (await rentDue())!;
    const patch = async (body: Row) =>
      ((await (await ann.patch(`/api/transactions/${rent.id}`, body)).json()) as TransactionResponse).transaction;

    expect(await patch({ recurringId: null })).toMatchObject({ recurringId: null, occurrenceDate: "2026-01-25" });
    expect(await patch({ recurringId: rentId })).toMatchObject({ recurringId: rentId, occurrenceDate: null });
    expect(await patch({ recurringId: cardId })).toMatchObject({ recurringId: cardId, occurrenceDate: null });
  });

  it("refuses an item that does not exist exactly as it refuses someone else's", async () => {
    const bob = await signUp("bob");
    const bobsItem = await addItem(bob, { name: "Bob's gym" });

    const unknown = await refused(ann, payment("2026-01-20", { recurringId: "no-such-id" }));
    const someoneElses = await refused(ann, payment("2026-01-20", { recurringId: bobsItem }));
    expect(unknown).toEqual({ recurringId: "No such recurring item" });
    expect(someoneElses).toEqual(unknown);

    const { transaction } = await create(ann, payment("2026-01-20"));
    const patched = await ann.patch(`/api/transactions/${transaction.id}`, { recurringId: bobsItem });
    expect(patched.status).toBe(400);
    expect((await patched.json()).error.fields).toEqual(unknown);
    expect((await listed(bob)).every((tx) => tx.name !== "Payment")).toBe(true);
  });
});

describe("paying a bill in parts", () => {
  it("shrinks the upcoming entry with each part and removes it with the last", async () => {
    const rent = (await rentDue())!;
    const before = await current(ann);
    const startings = await expectChainConsistent();

    const first = await create(ann, payment("2026-01-20", { countsToward: rent.id }));
    expect(first.transaction).toMatchObject({ recurringId: rentId, amountCents: -30_000, status: "paid" });
    expect(first.countedToward).toEqual({ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: -60_000, removed: false });
    expect(await rentDue()).toMatchObject({ id: rent.id, amountCents: -60_000, status: "upcoming" });

    const second = await create(ann, payment("2026-01-22", { countsToward: rent.id }));
    expect(second.countedToward).toMatchObject({ remainingCents: -30_000, removed: false });

    const third = await create(ann, payment("2026-01-24", { countsToward: rent.id }));
    expect(third.countedToward).toEqual({ id: rent.id, name: "Rent", previousCents: -30_000, remainingCents: 0, removed: true });
    expect(await rentDue()).toBeUndefined();

    // The money moved from upcoming to paid and nowhere else.
    const after = await current(ann);
    expect(after.totals).toEqual({
      paidCents: before.totals.paidCents - RENT,
      upcomingCents: before.totals.upcomingCents + RENT,
      leftoverCents: before.totals.leftoverCents - RENT,
      projectedCents: before.totals.projectedCents,
    });
    expect(await expectChainConsistent()).toEqual(startings);
    expect((await listed(ann)).filter((tx) => tx.recurringId === rentId).map((tx) => tx.name)).toEqual([
      "Payment",
      "Payment",
      "Payment",
    ]);
  });

  it("finishes the entry when a part is more than what is left, and counts the rest as spent", async () => {
    const rent = (await rentDue())!;
    const before = await current(ann);

    const { countedToward } = await create(ann, payment("2026-01-20", { amountCents: 100_000, countsToward: rent.id }));
    expect(countedToward).toMatchObject({ remainingCents: 0, removed: true });
    expect(await rentDue()).toBeUndefined();
    expect((await current(ann)).totals.projectedCents).toBe(before.totals.projectedCents - 10_000);
    await expectChainConsistent();
  });

  it("carries a part paid in an earlier period than the bill is due", async () => {
    const rent = (await rentDue())!;
    const startings = await expectChainConsistent();

    await create(ann, payment("2026-01-05", { countsToward: rent.id }));
    const after = await expectChainConsistent();
    // P1 holds the payment, so P2 starts $300 lower; P2's rent is $300 smaller, so P3 on is unchanged.
    expect(after).toEqual([startings[0], startings[1], startings[2]! - 30_000, startings[3], startings[4]]);
  });

  it("takes the item from the entry, and refuses a different one", async () => {
    const rent = (await rentDue())!;
    expect((await create(ann, payment("2026-01-20", { countsToward: rent.id, recurringId: rentId }))).transaction.recurringId).toBe(rentId);

    expect(await refused(ann, payment("2026-01-20", { countsToward: rent.id, recurringId: cardId }))).toEqual({
      countsToward: "That transaction belongs to a different recurring item",
    });
  });

  it("only counts toward an upcoming entry that a recurring item added", async () => {
    const typedIn = (await create(ann, payment("2026-01-21", { paid: false, recurringId: rentId }))).transaction;
    const notGenerated = "That isn't an upcoming transaction a recurring item added";
    expect(await refused(ann, payment("2026-01-20", { countsToward: typedIn.id }))).toEqual({ countsToward: notGenerated });

    const rent = (await rentDue())!;
    expect(await refused(ann, payment("2026-01-20", { kind: "income", countsToward: rent.id }))).toEqual({
      countsToward: "Money out can't count toward money coming in, or the other way round",
    });

    await ann.patch(`/api/transactions/${rent.id}`, { status: "paid" });
    expect(await refused(ann, payment("2026-01-20", { countsToward: rent.id }))).toEqual({ countsToward: notGenerated });

    expect(await refused(ann, payment("2026-01-20", { countsToward: "no-such-id" }))).toEqual({
      countsToward: "No such transaction",
    });
  });

  it("cannot reach another user's entry", async () => {
    const bob = await signUp("bob");
    await addItem(bob);
    const bobsRent = (await rentDue(bob))!;

    expect(await refused(ann, payment("2026-01-20", { countsToward: bobsRent.id }))).toEqual({
      countsToward: "No such transaction",
    });
    expect(await rentDue(bob)).toMatchObject({ amountCents: -RENT });
  });

  it("is left alone when the item is ended, unlike the entries the item generated", async () => {
    // A payment the owner typed in for a later date and tied to the rent.
    const { transaction } = await create(ann, payment("2026-02-05", { name: "Promised extra", paid: false, recurringId: rentId }));
    expect(await rentDue()).toBeDefined();

    const ended = await ann.post(`/api/recurring/${rentId}/end`, { removeUpcoming: true });
    expect(ended.status).toBe(200);

    // Rent due on the 25th was generated, upcoming and after today: gone. The typed-in one stays.
    expect(await rentDue()).toBeUndefined();
    expect((await listed(ann)).filter((tx) => tx.recurringId === rentId).map((tx) => tx.id)).toEqual([transaction.id]);
    await expectChainConsistent();
  });

  it("does not bring the entry back when the payment is deleted afterwards", async () => {
    const rent = (await rentDue())!;
    const { transaction } = await create(ann, payment("2026-01-20", { amountCents: RENT, countsToward: rent.id }));
    expect((await ann.delete(`/api/transactions/${transaction.id}`)).status).toBe(204);

    expect(await rentDue()).toBeUndefined();
    await expectChainConsistent();
  });
});

describe("links in an import", () => {
  async function importRows(transactions: Row[], options: Row = {}) {
    const response = await ann.post("/api/transactions/import", { transactions, ...options });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    return (await response.json()) as TransactionImportResponse;
  }

  it("ties rows to items and lets several rows pay toward one entry", async () => {
    const rent = (await rentDue())!;
    const before = await current(ann);
    const startings = await expectChainConsistent();

    const result = await importRows([
      payment("2026-01-20", { name: "Part one", countsToward: rent.id, importKey: "a" }),
      payment("2026-01-21", { name: "Card payment", amountCents: 4200, recurringId: cardId, importKey: "b" }),
      payment("2026-01-22", { name: "Part two", countsToward: rent.id, importKey: "c" }),
      payment("2026-01-23", { name: "Part three", countsToward: rent.id, importKey: "d" }),
      payment("2026-01-24", { name: "Unrelated", amountCents: 100, importKey: "e" }),
    ]);

    expect(result.created).toBe(5);
    expect(result.countedToward).toEqual([{ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: 0, removed: true }]);
    expect(result.possibleDuplicates).toEqual([]);
    expect(result.current).toMatchObject({
      projectedBeforeCents: before.totals.projectedCents,
      projectedAfterCents: before.totals.projectedCents - 4200 - 100,
    });

    const saved = (await listed(ann, "2026-01-20", "2026-01-25")).map((tx) => [tx.name, tx.recurringId]);
    expect(saved).toEqual([
      ["Part one", rentId],
      ["Card payment", cardId],
      ["Part two", rentId],
      ["Part three", rentId],
      ["Unrelated", null],
    ]);
    const after = await expectChainConsistent();
    expect(after.slice(0, 3)).toEqual(startings.slice(0, 3));
    expect(after[3]).toBe(startings[3]! - 4300);
  });

  it("reports a partly paid entry and still flags rows that say nothing about it", async () => {
    const rent = (await rentDue())!;
    const result = await importRows([
      payment("2026-01-20", { countsToward: rent.id }),
      // The same amount as what is left of the rent, two days from it, and no word on what it is.
      payment("2026-01-23", { name: "Mystery", amountCents: RENT }),
    ]);

    expect(result.countedToward).toEqual([{ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: -60_000, removed: false }]);
    expect(result.possibleDuplicates.map((duplicate) => duplicate.index)).toEqual([1]);
  });

  it("does not call a row a possible duplicate of the entry it says it pays", async () => {
    const rent = (await rentDue())!;
    const bankRow = payment("2026-01-26", { name: "ACH LANDLORD LLC", amountCents: RENT, importKey: "rent-jan" });

    // Left alone, the bank's row looks like the rent the app already expects.
    const unsure = await importRows([bankRow], { dryRun: true });
    expect(unsure.possibleDuplicates).toEqual([
      expect.objectContaining({ index: 0, reason: "recurring", existing: expect.objectContaining({ id: rent.id }) }),
    ]);

    // Told that it is that rent, the import replaces the expected entry with the real payment.
    const settled = await importRows([{ ...bankRow, countsToward: rent.id }]);
    expect(settled.possibleDuplicates).toEqual([]);
    expect(settled.countedToward).toEqual([{ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: 0, removed: true }]);
    expect((await listed(ann, "2026-01-25", "2026-01-26")).map((tx) => [tx.name, tx.status, tx.recurringId, tx.importKey])).toEqual([
      ["ACH LANDLORD LLC", "paid", rentId, "rent-jan"],
    ]);

    // And because the bank's row is now in the budget under its key, the next export that
    // lists it is skipped rather than flagged all over again.
    const nextExport = await importRows([bankRow], { dryRun: true });
    expect(nextExport).toMatchObject({ created: 0, skipped: [{ reason: "held" }], possibleDuplicates: [] });
  });

  it("previews without saving, and the real run then does the same", async () => {
    const rent = (await rentDue())!;
    const rows = [
      payment("2026-01-20", { countsToward: rent.id, importKey: "a" }),
      payment("2026-01-21", { recurringId: cardId, importKey: "b" }),
    ];
    const before = await everything(ann);

    const dry = await importRows(rows, { dryRun: true });
    expect(dry.countedToward).toEqual([{ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: -60_000, removed: false }]);
    expect(await everything(ann)).toEqual(before);

    const real = await importRows(rows);
    expect({ ...real, dryRun: true }).toEqual(dry);
    expect(await rentDue()).toMatchObject({ amountCents: -60_000 });
  });

  it("does not pay toward anything with a row it skips", async () => {
    const rent = (await rentDue())!;
    const rows = [payment("2026-01-20", { countsToward: rent.id, importKey: "a" })];
    await importRows(rows);

    const again = await importRows(rows);
    expect(again).toMatchObject({ created: 0, countedToward: [] });
    expect(await rentDue()).toMatchObject({ amountCents: -60_000 });
  });

  it("names each row whose link cannot be made and saves nothing", async () => {
    const rent = (await rentDue())!;
    const before = await everything(ann);
    const response = await ann.post("/api/transactions/import", {
      transactions: [
        payment("2026-01-20", { countsToward: rent.id }),
        payment("2026-01-20", { recurringId: "no-such-id" }),
        payment("2026-01-20", { countsToward: "no-such-id", recurringId: "also-missing" }),
        payment("2026-01-20", { kind: "income", countsToward: rent.id }),
      ],
    });

    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.message).toBe("3 of the 4 transactions have a link that can't be made. Nothing was imported.");
    expect(error.fields).toEqual({
      "transactions.1.recurringId": "No such recurring item",
      "transactions.2.recurringId": "No such recurring item",
      "transactions.2.countsToward": "No such transaction",
      "transactions.3.countsToward": "Money out can't count toward money coming in, or the other way round",
    });
    expect(await everything(ann)).toEqual(before);
  });
});

describe("suggesting the recurring item a row belongs to", () => {
  async function importRows(transactions: Row[], options: Row = { dryRun: true }, client: Client = ann) {
    const response = await client.post("/api/transactions/import", { transactions, ...options });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    return (await response.json()) as TransactionImportResponse;
  }
  const suggestions = async (rows: Row[], client: Client = ann) => (await importRows(rows, { dryRun: true }, client)).recurringSuggestions;
  const bank = (date: string, note: string, overrides: Row = {}) =>
    payment(date, { name: "Card payment", amountCents: 4200, note, ...overrides });

  it("points at the upcoming entry a row would pay, ready to be accepted", async () => {
    const rent = (await rentDue())!;
    const row = payment("2026-01-26", { name: "ACH LANDLORD LLC", amountCents: RENT, importKey: "rent-jan" });

    const [suggestion] = await suggestions([row]);
    expect(suggestion).toEqual({
      index: 0,
      recurringId: rentId,
      recurringName: "Rent",
      reason: "occurrence",
      countsToward: rent.id,
    });

    // Accepting it is copying those two values onto the row.
    const accepted = await importRows(
      [{ ...row, recurringId: suggestion!.recurringId, countsToward: suggestion!.countsToward }],
      {},
    );
    expect(accepted.countedToward).toEqual([{ id: rent.id, name: "Rent", previousCents: -RENT, remainingCents: 0, removed: true }]);
    expect(accepted.recurringSuggestions).toEqual([]);
  });

  it("learns a bank description from a row that was tied by hand, and knows it next time", async () => {
    expect(await suggestions([bank("2026-01-20", "CAPITAL ONE MOBILE PMT 4417")])).toEqual([]);

    await importRows([bank("2026-01-20", "CAPITAL ONE MOBILE PMT 4417", { recurringId: cardId, importKey: "a" })], {});

    expect(
      await suggestions([
        // The same description, however the bank happens to space or capitalise it.
        bank("2026-02-14", "capital one  mobile pmt   4417", { amountCents: 9900, name: "Something else" }),
        // A different description under a different name: nothing to go on.
        bank("2026-02-15", "CAPITAL ONE MOBILE PMT 9999", { name: "Unrelated" }),
      ]),
    ).toEqual([{ index: 0, recurringId: cardId, recurringName: "Credit card", reason: "same_description" }]);
  });

  it("also learns from the name, and lets the latest use decide between two items", async () => {
    await create(ann, payment("2026-01-10", { name: "Venmo Sam", recurringId: rentId }));
    await create(ann, payment("2026-01-20", { name: "Venmo Sam", recurringId: cardId }));

    expect(await suggestions([payment("2026-02-01", { name: "VENMO SAM" })])).toEqual([
      { index: 0, recurringId: cardId, recurringName: "Credit card", reason: "same_description" },
    ]);
  });

  it("falls back on the item's own name appearing in the row, as whole words", async () => {
    const found = await suggestions([
      payment("2026-02-01", { name: "RENT - FEBRUARY" }),
      payment("2026-02-01", { name: "Online pmt", note: "ref 88 credit card autopay" }),
      // "rent" is inside these words, not a word in them.
      payment("2026-02-01", { name: "Current account fee", note: "parental transfer" }),
      payment("2026-02-01", { name: "Groceries" }),
    ]);
    expect(found.map(({ index, recurringName, reason }) => [index, recurringName, reason])).toEqual([
      [0, "Rent", "name"],
      [1, "Credit card", "name"],
    ]);
  });

  it("prefers the longer of two item names that both appear", async () => {
    await addItem(ann, { name: "Card", firstDueDate: "2026-06-01" });
    const found = await suggestions([payment("2026-02-01", { name: "Credit card payment" })]);
    expect(found.map((suggestion) => suggestion.recurringName)).toEqual(["Credit card"]);
  });

  it("says nothing about a row that has already been told, or that is skipped", async () => {
    const rent = (await rentDue())!;
    await importRows([payment("2026-01-10", { name: "Rent early", importKey: "held" })], {});

    expect(
      await suggestions([
        payment("2026-02-01", { name: "Rent", recurringId: cardId }),
        payment("2026-01-24", { name: "Rent", countsToward: rent.id }),
        payment("2026-01-10", { name: "Rent early", importKey: "held" }),
      ]),
    ).toEqual([]);
  });

  it("does not suggest counting toward an entry that is already paid", async () => {
    const rent = (await rentDue())!;
    await ann.patch(`/api/transactions/${rent.id}`, { status: "paid" });

    const result = await importRows([payment("2026-01-26", { name: "ACH LANDLORD LLC", amountCents: RENT })]);
    // Still a possible duplicate of the paid rent, but there is nothing left to pay toward.
    expect(result.possibleDuplicates).toHaveLength(1);
    expect(result.recurringSuggestions).toEqual([]);
  });

  it("forgets what it learned from an item once the item is deleted", async () => {
    await create(ann, payment("2026-01-20", { name: "Gym", note: "PLANET FIT 0042", recurringId: cardId }));
    expect((await ann.delete(`/api/recurring/${cardId}`)).status).toBe(204);

    expect(await suggestions([payment("2026-02-20", { name: "Gym", note: "PLANET FIT 0042" })])).toEqual([]);
  });

  it("never draws on another user's items or transactions", async () => {
    const bob = await signUp("bob");
    const bobsItem = await addItem(bob, { name: "Streaming" });
    await create(bob, payment("2026-01-20", { name: "Movies", note: "NETFLIX.COM 866", recurringId: bobsItem }));

    expect(
      await suggestions([
        payment("2026-02-01", { name: "Streaming" }),
        payment("2026-02-01", { name: "Movies", note: "NETFLIX.COM 866" }),
      ]),
    ).toEqual([]);

    // And what someone else did later with the same description does not hide her own link.
    await create(ann, payment("2026-01-10", { name: "Films", note: "NETFLIX.COM 866", recurringId: cardId }));
    await create(bob, payment("2026-01-25", { name: "Films", note: "NETFLIX.COM 866", recurringId: bobsItem }));
    expect(await suggestions([payment("2026-02-01", { name: "Whatever", note: "NETFLIX.COM 866" })])).toEqual([
      { index: 0, recurringId: cardId, recurringName: "Credit card", reason: "same_description" },
    ]);
  });
});
