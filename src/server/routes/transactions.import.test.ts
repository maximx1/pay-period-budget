import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import { MAX_IMPORT_ROWS, type Transaction, type TransactionImportResponse } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// and, when added, P-1 2025-12-02..12-15 and P-2 2025-11-18..12-01.
const OPENING = 100_000;

let t: TestApp;
let ann: Client;
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

const userId = async (name: string) => (await t.store.users.findByUsername(name))!.id;

const row = (date: string, overrides: Row = {}): Row => ({
  name: "Groceries",
  amountCents: 2500,
  kind: "expense",
  occursAt: `${date}T00:00`,
  paid: true,
  ...overrides,
});

async function importRows(client: Client, transactions: Row[], options: Row = {}) {
  const response = await client.post("/api/transactions/import", { transactions, ...options });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return (await response.json()) as TransactionImportResponse;
}

async function addRent(client: Client, firstDueDate: string) {
  const response = await client.post("/api/bills-income", {
    name: "Rent",
    kind: "expense",
    defaultAmountCents: 90_000,
    recurrenceUnit: "month",
    recurrenceInterval: 1,
    firstDueDate,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
}

/** Everything an import can change, in a form two accounts can be compared by. */
async function snapshot(name: string) {
  const id = await userId(name);
  const periods = await t.store.periods.listAll(id);
  const transactions = await t.store.transactions.listInRange(id, "2025-01-01", "2027-12-31");
  return {
    periods: periods.map(({ seq, startDate, endDate, startingCents, startingMode, carryStale }) => ({
      seq,
      startDate,
      endDate,
      startingCents,
      startingMode,
      carryStale,
    })),
    transactions: transactions.map(({ name: txName, amountCents, occursAt, status, sortOrder, note, importKey }) => ({
      name: txName,
      amountCents,
      occursAt,
      status,
      sortOrder,
      note,
      imported: importKey !== null,
    })),
  };
}

const listed = async (client: Client, from: string, to: string) =>
  ((await (await client.get(`/api/transactions?from=${from}&to=${to}`)).json()) as { transactions: Transaction[] })
    .transactions;

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("importing transactions", () => {
  it("leaves exactly what adding the same rows one at a time leaves", async () => {
    const bob = await signUp("bob");
    for (const client of [ann, bob]) {
      // A bill that will also land in the periods added before the budget.
      await addRent(client, "2025-11-05");
      // A starting amount set by hand: nothing before it may carry past it.
      const periods = await t.store.periods.listAll(await userId(client === ann ? "ann" : "bob"));
      const pinned = await client.patch(`/api/periods/${periods[3]!.id}/starting`, {
        startingCents: 50_000,
        carryForward: true,
      });
      expect(pinned.status).toBe(200);
    }

    const rows = [
      row("2026-01-20", { name: "Later the same day", occursAt: "2026-01-20T18:30" }),
      row("2025-11-20", { name: "Two periods before the budget" }),
      row("2025-12-10", { name: "One period before the budget", amountCents: 4100 }),
      row("2025-12-16", { name: "First day of the budget", amountCents: 300, paid: false }),
      row("2026-01-05", { name: "Paycheck", amountCents: 210_000, kind: "income" }),
      row("2026-01-05", { name: "Same moment as the paycheck", amountCents: 1999, note: "split" }),
      row("2026-01-20", { name: "In the current period" }),
      row("2026-01-20", { name: "Also in the current period", amountCents: 777, paid: false }),
      row("2026-02-03", { name: "In the pinned period", amountCents: 1200 }),
      row("2026-02-15", { name: "After the pinned period", amountCents: 650 }),
      row("2026-03-12", { name: "In a period not generated yet", amountCents: 8800, paid: false }),
    ];

    const result = await importRows(
      ann,
      rows.map((r, index) => ({ ...r, importKey: `bank-${index}` })),
      { addEarlierPeriods: true },
    );
    expect(result).toMatchObject({ created: rows.length, skipped: [], periodsAdded: { earlier: 2, later: 2 } });

    expect((await bob.post("/api/periods/earlier")).status).toBe(200);
    expect((await bob.post("/api/periods/earlier")).status).toBe(200);
    for (const r of rows) {
      const response = await bob.post("/api/transactions", r);
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    }

    const [imported, oneByOne] = [await snapshot("ann"), await snapshot("bob")];
    expect(imported.periods).toEqual(oneByOne.periods);
    expect(imported.transactions.map(({ imported: _, ...rest }) => rest)).toEqual(
      oneByOne.transactions.map(({ imported: _, ...rest }) => rest),
    );
    // And it did do something: nine periods, the rent in the added ones, and money moved.
    expect(imported.periods.map((period) => period.seq)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6]);
    expect(imported.periods[2]).toMatchObject({ seq: 0, startingCents: OPENING });
    expect(imported.periods[3]!.startingCents).toBe(OPENING - 300);
    expect(imported.periods[5]).toMatchObject({ seq: 3, startingMode: "manual", startingCents: 50_000 });
    expect(imported.transactions.filter((tx) => tx.name === "Rent").map((tx) => tx.occursAt)).toContain(
      "2025-12-05T00:00",
    );
  });

  it("saves each row as given and reports where they went", async () => {
    const result = await importRows(ann, [
      row("2026-01-05", { name: " Coffee ", amountCents: 450, note: " with Sam ", importKey: " bank-1 " }),
      row("2026-01-20", { name: "Refund", amountCents: 1500, kind: "income", paid: false }),
      row("2026-01-21", { name: "Lunch", amountCents: 1200 }),
    ]);

    const periods = await t.store.periods.listAll(await userId("ann"));
    expect(result).toEqual({
      dryRun: false,
      created: 3,
      skipped: [],
      periodsAdded: { earlier: 0, later: 0 },
      periods: [
        { id: periods[1]!.id, startDate: "2025-12-30", endDate: "2026-01-12", count: 1, netCents: -450 },
        { id: periods[2]!.id, startDate: "2026-01-13", endDate: "2026-01-26", count: 2, netCents: 300 },
      ],
      possibleDuplicates: [],
      countedToward: [],
      billOrIncomeSuggestions: [],
      current: {
        periodId: periods[2]!.id,
        leftoverBeforeCents: OPENING,
        leftoverAfterCents: OPENING - 450 - 1200,
        projectedBeforeCents: OPENING,
        projectedAfterCents: OPENING - 450 + 300,
      },
    });

    const saved = await listed(ann, "2026-01-01", "2026-01-31");
    expect(saved).toEqual([
      expect.objectContaining({
        name: "Coffee",
        amountCents: -450,
        kind: "expense",
        occursAt: "2026-01-05T00:00",
        status: "paid",
        paidAt: t.clock.now().toISOString(),
        note: "with Sam",
        importKey: "bank-1",
        billIncomeId: null,
      }),
      expect.objectContaining({ name: "Refund", amountCents: 1500, status: "upcoming", paidAt: null, importKey: null }),
      expect.objectContaining({ name: "Lunch", amountCents: -1200, status: "paid", note: null }),
    ]);
  });

  it("puts rows that share a date and time after what is already there, in the order given", async () => {
    await ann.post("/api/transactions", row("2026-01-20", { name: "already here" }));
    await importRows(ann, [
      row("2026-01-20", { name: "first" }),
      row("2026-01-21", { name: "other day" }),
      row("2026-01-20", { name: "second" }),
    ]);

    const saved = await listed(ann, "2026-01-20", "2026-01-20");
    expect(saved.map((tx) => [tx.name, tx.sortOrder])).toEqual([
      ["already here", 0],
      ["first", 1],
      ["second", 2],
    ]);
  });

  it("leaves today's figures alone when every row is before the budget began", async () => {
    const result = await importRows(ann, [row("2025-12-10"), row("2025-11-20")], { addEarlierPeriods: true });

    expect(result.periodsAdded).toEqual({ earlier: 2, later: 0 });
    expect(result.current).toMatchObject({
      leftoverBeforeCents: OPENING,
      leftoverAfterCents: OPENING,
      projectedBeforeCents: OPENING,
      projectedAfterCents: OPENING,
    });
    const periods = (await snapshot("ann")).periods;
    // History is worked backwards: each period before the budget starts higher by what was spent in it.
    expect(periods.map((period) => [period.seq, period.startingCents]).slice(0, 3)).toEqual([
      [-2, OPENING + 5000],
      [-1, OPENING + 2500],
      [0, OPENING],
    ]);
  });
});

describe("a dry run", () => {
  it("reports what the real run then does, and saves nothing", async () => {
    await addRent(ann, "2025-12-05");
    const rows = [
      row("2025-12-06", { name: "Rent payment", amountCents: 90_000, importKey: "a" }),
      row("2026-01-20", { importKey: "b" }),
      row("2026-03-12", { importKey: "c" }),
    ];
    const before = await snapshot("ann");

    const dry = await importRows(ann, rows, { dryRun: true, addEarlierPeriods: true });
    expect(dry).toMatchObject({ dryRun: true, created: 3, periodsAdded: { earlier: 1, later: 2 } });
    expect(dry.possibleDuplicates).toEqual([
      expect.objectContaining({ index: 0, reason: "generated", daysApart: 1 }),
    ]);
    expect(await snapshot("ann")).toEqual(before);

    const real = await importRows(ann, rows, { addEarlierPeriods: true });
    // Periods and transactions created along the way get new ids each time; all else must agree.
    const comparable = (result: TransactionImportResponse) => ({
      ...result,
      dryRun: null,
      periods: result.periods.map(({ id: _, ...rest }) => rest),
      possibleDuplicates: result.possibleDuplicates.map((duplicate) => ({
        ...duplicate,
        existing: { ...duplicate.existing, id: null },
      })),
      billOrIncomeSuggestions: result.billOrIncomeSuggestions.map((suggestion) => ({
        ...suggestion,
        countsToward: suggestion.countsToward ? "an id" : undefined,
      })),
    });
    expect(dry.billOrIncomeSuggestions).toEqual([
      expect.objectContaining({ index: 0, billIncomeName: "Rent", reason: "occurrence", countsToward: expect.any(String) }),
    ]);
    expect(comparable(real)).toEqual(comparable(dry));
    expect(real.dryRun).toBe(false);
    expect((await snapshot("ann")).transactions.filter((tx) => tx.imported)).toHaveLength(3);
  });

  it("checks rows the same way a real run does", async () => {
    const response = await ann.post("/api/transactions/import", {
      dryRun: true,
      transactions: [row("2025-12-01")],
    });
    expect(response.status).toBe(400);
  });
});

describe("importing the same rows again", () => {
  const rows = [
    row("2026-01-05", { importKey: "bank-1" }),
    row("2026-01-20", { importKey: "bank-2", amountCents: 900 }),
  ];

  it("adds nothing the second time", async () => {
    await importRows(ann, rows);
    const after = await snapshot("ann");

    const again = await importRows(ann, rows);
    expect(again).toMatchObject({
      created: 0,
      skipped: [
        { index: 0, importKey: "bank-1", reason: "held" },
        { index: 1, importKey: "bank-2", reason: "held" },
      ],
      periods: [],
      possibleDuplicates: [],
    });
    expect(again.current?.projectedAfterCents).toBe(again.current?.projectedBeforeCents);
    expect(await snapshot("ann")).toEqual(after);
  });

  it("adds only the rows it has not seen", async () => {
    await importRows(ann, rows);
    const result = await importRows(ann, [
      rows[1]!,
      row("2026-01-21", { importKey: "bank-3", name: "New" }),
      row("2026-01-22", { name: "No key, so always new" }),
    ]);

    expect(result).toMatchObject({ created: 2, skipped: [{ index: 0, importKey: "bank-2", reason: "held" }] });
    expect((await listed(ann, "2026-01-13", "2026-01-26")).map((tx) => tx.name)).toEqual([
      "Groceries",
      "New",
      "No key, so always new",
    ]);
  });

  it("keeps each user's keys apart", async () => {
    const bob = await signUp("bob");
    await importRows(bob, rows);

    expect(await importRows(ann, rows)).toMatchObject({ created: 2, skipped: [] });
    expect(await listed(bob, "2026-01-01", "2026-01-31")).toHaveLength(2);
    expect(await listed(ann, "2026-01-01", "2026-01-31")).toHaveLength(2);
  });
});

describe("an imported transaction the user deleted", () => {
  const rows = [
    row("2026-01-05", { importKey: "bank-1", name: "Unwanted" }),
    row("2026-01-20", { importKey: "bank-2", amountCents: 900 }),
  ];
  const idOf = async (client: Client, name: string) =>
    (await listed(client, "2026-01-01", "2026-01-31")).find((tx) => tx.name === name)!.id;
  const names = async (client: Client) => (await listed(client, "2026-01-01", "2026-01-31")).map((tx) => tx.name);

  beforeEach(async () => {
    await importRows(ann, rows);
    expect((await ann.delete(`/api/transactions/${await idOf(ann, "Unwanted")}`)).status).toBe(204);
  });

  it("stays deleted when the same rows are imported again", async () => {
    const afterDelete = await snapshot("ann");

    const again = await importRows(ann, [...rows, row("2026-01-21", { importKey: "bank-3", name: "New" })]);
    expect(again).toMatchObject({
      created: 1,
      skipped: [
        { index: 0, importKey: "bank-1", reason: "deleted" },
        { index: 1, importKey: "bank-2", reason: "held" },
      ],
      possibleDuplicates: [],
    });
    expect(await names(ann)).toEqual(["Groceries", "New"]);
    // Nothing but the new row moved: the periods before it are as the deletion left them.
    expect((await snapshot("ann")).periods.slice(0, 3)).toEqual(afterDelete.periods.slice(0, 3));
  });

  it("comes back only when the import asks for it, and is then an ordinary imported row", async () => {
    const restored = await importRows(ann, rows, { restoreDeleted: true });
    expect(restored).toMatchObject({ created: 1, skipped: [{ index: 1, importKey: "bank-2", reason: "held" }] });
    expect(await names(ann)).toEqual(["Unwanted", "Groceries"]);

    expect((await importRows(ann, rows)).skipped.map((skip) => skip.reason)).toEqual(["held", "held"]);

    // Deleted a second time, it is remembered a second time.
    expect((await ann.delete(`/api/transactions/${await idOf(ann, "Unwanted")}`)).status).toBe(204);
    expect((await importRows(ann, rows)).skipped.map((skip) => skip.reason)).toEqual(["deleted", "held"]);
  });

  it("is not forgotten by a dry run that asks for it back", async () => {
    const dry = await importRows(ann, rows, { dryRun: true, restoreDeleted: true });
    expect(dry).toMatchObject({ dryRun: true, created: 1 });

    expect(await importRows(ann, rows)).toMatchObject({ created: 0, skipped: [{ reason: "deleted" }, { reason: "held" }] });
    expect(await names(ann)).toEqual(["Groceries"]);
  });

  it("is each user's own business", async () => {
    const bob = await signUp("bob");
    expect(await importRows(bob, rows)).toMatchObject({ created: 2, skipped: [] });
    expect(await names(bob)).toEqual(["Unwanted", "Groceries"]);
  });

  it("is only remembered when it had been imported", async () => {
    const typedIn = await (await ann.post("/api/transactions", row("2026-01-22", { name: "typed in" }))).json();
    expect((await ann.delete(`/api/transactions/${typedIn.transaction.id}`)).status).toBe(204);

    const id = await userId("ann");
    expect(await t.store.transactions.findDeletedImportKeys(id, ["bank-1", "bank-2", "typed in"])).toEqual(["bank-1"]);
  });
});

describe("rows that cannot be imported", () => {
  async function refused(body: Row) {
    const before = await snapshot("ann");
    const response = await ann.post("/api/transactions/import", body);
    expect(response.status).toBe(400);
    // All or nothing: no row, and no period made along the way, survives.
    expect(await snapshot("ann")).toEqual(before);
    return (await response.json()).error as { message: string; fields: Record<string, string> };
  }

  it("names each bad row and saves none of them", async () => {
    const error = await refused({
      transactions: [
        row("2026-01-20"),
        row("2026-01-20", { amountCents: 0 }),
        row("2026-01-20", { name: "" }),
        { ...row("2026-01-20"), occursAt: "2026-01-20" },
      ],
    });
    expect(error.fields).toEqual({
      "transactions.1.amountCents": "Enter an amount greater than zero",
      "transactions.2.name": "Enter a name",
      "transactions.3.occursAt": "Enter a valid date and time",
    });
  });

  it("refuses a row before the budget unless earlier periods are asked for", async () => {
    const error = await refused({ transactions: [row("2026-01-20"), row("2025-12-15"), row("2026-03-12")] });
    expect(error.fields).toEqual({ "transactions.1.occursAt": "That's before your budget started" });
    expect(error.message).toBe("1 of the 3 transactions is dated outside your pay periods. Nothing was imported.");
  });

  it("refuses rows more than five years back or a year ahead, even when earlier periods are asked for", async () => {
    const error = await refused({
      addEarlierPeriods: true,
      transactions: [row("2025-12-10"), row("2021-01-04"), row("2027-03-01"), row("2026-12-01"), row("2021-01-05")],
    });
    // Five years before today falls in the period 2021-01-05..01-18: its first day is in reach, the day before is not.
    expect(error.fields).toEqual({
      "transactions.1.occursAt": "That's more than 5 years back",
      "transactions.2.occursAt": "That's more than a year ahead",
    });
  });

  it("refuses the same key twice in one request", async () => {
    const error = await refused({
      transactions: [
        row("2026-01-20", { importKey: "same" }),
        row("2026-01-21"),
        row("2026-01-22", { importKey: "same" }),
      ],
    });
    expect(error.fields).toEqual({ "transactions.2.importKey": "Row 0 of this request has the same key" });
  });

  it.each([
    ["no rows", { transactions: [] }],
    ["no list", {}],
    ["too many rows", { transactions: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => row("2026-01-20")) }],
  ])("refuses %s", async (_label, body) => {
    expect(Object.keys((await refused(body)).fields)).toEqual(["transactions"]);
  });

  it("needs a budget", async () => {
    const carl = t.client();
    await carl.post("/api/auth/register", { username: "carl", email: "carl@example.com", password: "correct horse" });
    const response = await carl.post("/api/transactions/import", { transactions: [row("2026-01-20")] });
    expect(response.status).toBe(409);
  });
});

describe("a full-sized import", () => {
  it(`takes ${MAX_IMPORT_ROWS} rows in a body larger than other endpoints accept`, async () => {
    const note = "x".repeat(300);
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => {
      const day = String(1 + (index % 28)).padStart(2, "0");
      return row(`2026-01-${day}`, { amountCents: 100 + index, note, importKey: `bank-${index}` });
    });
    expect(JSON.stringify({ transactions: rows }).length).toBeGreaterThan(150 * 1024);

    const result = await importRows(ann, rows);
    expect(result.created).toBe(MAX_IMPORT_ROWS);
    const total = rows.reduce((sum, r) => sum + (r.amountCents as number), 0);
    expect(result.periods.reduce((sum, period) => sum + period.netCents, 0)).toBe(-total);

    // Starting amounts still follow from what came before them.
    const id = await userId("ann");
    const periods = await t.store.periods.listAll(id);
    for (let i = 1; i < periods.length; i++) {
      const previous = periods[i - 1]!;
      const sums = await t.store.transactions.sumInRange(id, previous.startDate, previous.endDate);
      expect(periods[i]!.startingCents).toBe(previous.startingCents + sums.paidCents + sums.upcomingCents);
    }

    // The larger body is this endpoint's alone.
    const elsewhere = await ann.post("/api/transactions", { ...row("2026-01-20"), note: "x".repeat(150 * 1024) });
    expect(elsewhere.status).toBe(413);
    expect((await elsewhere.json()).error).toEqual({ code: "validation", message: "That request is too large" });

    const tooBig = await ann.post("/api/transactions/import", {
      transactions: [row("2026-01-20", { note: "x".repeat(1100 * 1024) })],
    });
    expect(tooBig.status).toBe(413);
  });
});

describe("years of history", () => {
  /** Before the budget, every period must end on what the next one starts with. */
  async function expectHistoryConsistent() {
    const id = await userId("ann");
    const periods = await t.store.periods.listAll(id);
    for (let i = 0; i < periods.length - 1 && periods[i]!.seq < 0; i++) {
      const sums = await t.store.transactions.sumInRange(id, periods[i]!.startDate, periods[i]!.endDate);
      expect(periods[i]!.startingCents + sums.paidCents + sums.upcomingCents, `end of period ${periods[i]!.seq}`).toBe(
        periods[i + 1]!.startingCents,
      );
    }
    return periods;
  }

  it("holds almost five years before the budget without moving today's figures", async () => {
    // A bill that has been due since before the history starts: it lands in every added period's month.
    await addRent(ann, "2021-01-25");
    // One row every four days from 2021-02-01 up to the day before the budget began.
    const rows: Row[] = [];
    for (let day = new Date(Date.UTC(2021, 1, 1)); day < new Date(Date.UTC(2025, 11, 16)); day.setUTCDate(day.getUTCDate() + 4)) {
      const date = day.toISOString().slice(0, 10);
      rows.push(row(date, { amountCents: 1000 + rows.length, importKey: `bank-${date}` }));
    }
    expect(rows.length).toBeGreaterThan(400);
    expect(rows.length).toBeLessThanOrEqual(MAX_IMPORT_ROWS);

    const result = await importRows(ann, rows, { addEarlierPeriods: true });
    // 2021-02-01 is the last day of period -128.
    expect(result).toMatchObject({ created: rows.length, periodsAdded: { earlier: 128, later: 0 } });
    expect(result.current).toMatchObject({
      leftoverBeforeCents: result.current!.leftoverAfterCents,
      projectedBeforeCents: result.current!.projectedAfterCents,
    });

    const periods = await expectHistoryConsistent();
    expect(periods[0]).toMatchObject({ seq: -128, startDate: "2021-01-19", endDate: "2021-02-01" });
    expect(periods.find((period) => period.seq === 0)!.startingCents).toBe(OPENING);
    // The rent was generated all the way back, as upcoming, and reported against nothing.
    const history = await t.store.transactions.listInRange(await userId("ann"), "2021-01-01", "2025-12-15");
    const rents = history.filter((tx) => tx.name === "Rent");
    expect(rents).toHaveLength(59);
    expect(rents.every((tx) => tx.status === "upcoming")).toBe(true);

    // One more transaction at each end of the history still leaves it consistent.
    expect((await ann.post("/api/transactions", row("2021-01-20"))).status).toBe(201);
    expect((await ann.post("/api/transactions", row("2025-12-15"))).status).toBe(201);
    const after = await expectHistoryConsistent();
    expect(after.find((period) => period.seq === 0)!.startingCents).toBe(OPENING);
    expect(after[0]!.startingCents).toBe(periods[0]!.startingCents + 2500 + 2500);

    const list = await ann.get("/api/periods");
    expect((await list.json()).periods).toHaveLength(128 + 5);
  });
});

describe("possible duplicates", () => {
  const duplicatesOf = async (client: Client, rows: Row[], options: Row = { dryRun: true }) =>
    (await importRows(client, rows, options)).possibleDuplicates;

  it("points at a generated bill of the same amount up to three days away", async () => {
    await addRent(ann, "2026-01-23");
    const [rent] = await listed(ann, "2026-01-23", "2026-01-23");

    const found = await duplicatesOf(ann, [
      row("2026-01-26", { name: "ACH LANDLORD LLC", amountCents: 90_000 }),
      row("2026-01-27", { name: "four days later", amountCents: 90_000 }),
      row("2026-01-19", { name: "four days earlier", amountCents: 90_000 }),
      row("2026-01-23", { name: "another amount", amountCents: 90_001 }),
      row("2026-01-23", { name: "money in, not out", amountCents: 90_000, kind: "income" }),
      row("2026-01-20", { name: "three days earlier", amountCents: 90_000 }),
    ]);

    expect(found).toEqual([
      { index: 0, existing: rent, reason: "generated", daysApart: 3 },
      { index: 5, existing: rent, reason: "generated", daysApart: 3 },
    ]);
  });

  it("points at something entered by hand, and prefers the closest date", async () => {
    await addRent(ann, "2026-01-23");
    await ann.post("/api/transactions", row("2026-01-21", { name: "typed in", amountCents: 90_000 }));

    const found = await duplicatesOf(ann, [
      row("2026-01-21", { amountCents: 90_000 }),
      row("2026-01-22", { amountCents: 90_000 }),
      row("2026-01-23", { amountCents: 90_000 }),
    ]);
    expect(found.map(({ index, reason, daysApart, existing }) => [index, reason, daysApart, existing.name])).toEqual([
      [0, "manual", 0, "typed in"],
      // A day from each: the generated bill is the likelier match.
      [1, "generated", 1, "Rent"],
      [2, "generated", 0, "Rent"],
    ]);
  });

  it("treats an imported transaction as a different payment unless date and name match too", async () => {
    await importRows(ann, [row("2026-01-21", { name: "Coffee", amountCents: 500, importKey: "old-scheme-1" })]);

    const found = await duplicatesOf(ann, [
      row("2026-01-21", { name: "coffee", amountCents: 500, importKey: "new-scheme-1" }),
      row("2026-01-22", { name: "Coffee", amountCents: 500, importKey: "new-scheme-2" }),
      row("2026-01-21", { name: "Tea", amountCents: 500, importKey: "new-scheme-3" }),
      row("2026-01-21", { name: "Coffee", amountCents: 500, importKey: "old-scheme-1" }),
    ]);
    expect(found.map(({ index, reason }) => [index, reason])).toEqual([[0, "imported"]]);
  });

  it("includes bills generated in periods the import itself adds", async () => {
    await addRent(ann, "2025-12-05");
    const found = await duplicatesOf(ann, [row("2025-12-06", { amountCents: 90_000 })], {
      dryRun: true,
      addEarlierPeriods: true,
    });
    expect(found).toEqual([
      expect.objectContaining({ index: 0, reason: "generated", daysApart: 1, existing: expect.objectContaining({ name: "Rent" }) }),
    ]);
  });

  it("is a report only: the rows are still imported", async () => {
    await ann.post("/api/transactions", row("2026-01-20", { name: "typed in" }));
    const result = await importRows(ann, [row("2026-01-20", { name: "from the bank" })]);

    expect(result.created).toBe(1);
    expect(result.possibleDuplicates).toHaveLength(1);
    expect((await listed(ann, "2026-01-20", "2026-01-20")).map((tx) => tx.name)).toEqual(["typed in", "from the bank"]);
  });

  it("never reports another user's transactions", async () => {
    const bob = await signUp("bob");
    await bob.post("/api/transactions", row("2026-01-20"));
    await addRent(bob, "2026-01-23");

    expect(await duplicatesOf(ann, [row("2026-01-20"), row("2026-01-23", { amountCents: 90_000 })])).toEqual([]);
  });
});

describe("who may import", () => {
  const body = { transactions: [row("2026-01-20")] };

  it("requires signing in", async () => {
    expect((await t.client().post("/api/transactions/import", body)).status).toBe(401);
  });

  it("accepts a write token and refuses a read token, dry run or not", async () => {
    const token = async (scope: string) =>
      (await (await ann.post("/api/auth/tokens", { name: scope, scope })).json()).secret as string;
    const as = (secret: string) => ({ authorization: `Bearer ${secret}` });
    const [read, write] = [await token("read"), await token("write")];

    expect((await t.client().post("/api/transactions/import", body, as(read))).status).toBe(403);
    expect((await t.client().post("/api/transactions/import", { ...body, dryRun: true }, as(read))).status).toBe(403);
    expect(await listed(ann, "2026-01-20", "2026-01-20")).toEqual([]);

    expect((await t.client().post("/api/transactions/import", body, as(write))).status).toBe(200);
    expect(await listed(ann, "2026-01-20", "2026-01-20")).toHaveLength(1);
  });

  it("only ever writes to the caller's own budget", async () => {
    const bob = await signUp("bob");
    const before = await snapshot("ann");
    await importRows(bob, [row("2026-01-05"), row("2025-12-10")], { addEarlierPeriods: true });

    expect(await snapshot("ann")).toEqual(before);
    const view = (await (await ann.get("/api/periods/current")).json()) as PeriodView;
    expect(view.totals.projectedCents).toBe(OPENING);
  });
});
