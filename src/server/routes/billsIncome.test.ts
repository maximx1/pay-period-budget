import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import { dateOf } from "../../shared/dates.ts";
import type { BillOrIncome, BillOrIncomePreview } from "../../shared/billsIncome.ts";
import type { Transaction } from "../../shared/transactions.ts";
import type { PeriodRecord } from "../repos/types.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// Same calendar as the transaction tests. The clock starts at 2026-01-15T12:00Z (UTC budget):
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
const OPENING = 100_000;
const DAY = 24 * 60 * 60 * 1000;

let t: TestApp;
let ann: Client;
let annId: string;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: OPENING, timezone: "UTC" });
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  annId = (await t.store.users.findByUsername("ann"))!.id;
});
afterEach(() => t.cleanup());

const internet = (overrides: Record<string, unknown> = {}) => ({
  name: "Internet",
  kind: "expense",
  defaultAmountCents: 6000,
  recurrenceUnit: "month",
  firstDueDate: "2026-01-25",
  ...overrides,
});

async function createItem(client: Client, body: Record<string, unknown>): Promise<BillOrIncome> {
  const response = await client.post("/api/bills-income", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

const listItems = async (client: Client) => ((await (await client.get("/api/bills-income")).json()).items as BillOrIncome[]);
const periods = () => t.store.periods.listFromSeq(annId, 0);
const startings = async () => (await periods()).map((p) => p.startingCents);
const viewOf = async (period: PeriodRecord) => (await (await ann.get(`/api/periods/${period.id}`)).json()) as PeriodView;

/** Generated transactions per period, as [date, signed amount] pairs. */
async function generatedByPeriod(billIncomeId?: string): Promise<Array<Array<[string, number]>>> {
  const result: Array<Array<[string, number]>> = [];
  for (const period of await periods()) {
    const rows = (await viewOf(period)).transactions.filter((tx) =>
      billIncomeId ? tx.billIncomeId === billIncomeId : tx.billIncomeId !== null,
    );
    result.push(rows.map((tx) => [dateOf(tx.occursAt), tx.amountCents]));
  }
  return result;
}

async function allGenerated(billIncomeId: string): Promise<Transaction[]> {
  const rows: Transaction[] = [];
  for (const period of await periods()) {
    rows.push(...(await viewOf(period)).transactions.filter((tx) => tx.billIncomeId === billIncomeId));
  }
  return rows;
}

async function expectChainConsistent() {
  const all = await periods();
  for (let i = 1; i < all.length; i++) {
    if (all[i]!.startingMode === "manual") continue;
    const previous = all[i - 1]!;
    const sums = await t.store.transactions.sumInRange(annId, previous.startDate, previous.endDate);
    expect(all[i]!.startingCents, `starting amount of period ${i}`).toBe(
      previous.startingCents + sums.paidCents + sums.upcomingCents,
    );
  }
}

describe("bills and income: create, read, update, delete", () => {
  it("round-trips an item with its computed fields", async () => {
    const created = await createItem(ann, internet({ description: "Account 123\nhttps://example.com/pay", recurrenceInterval: 1 }));

    expect(created).toEqual({
      id: expect.any(String),
      name: "Internet",
      description: "Account 123\nhttps://example.com/pay",
      kind: "expense",
      openingCents: 0,
      defaultAmountCents: 6000,
      recurrenceUnit: "month",
      recurrenceInterval: 1,
      firstDueDate: "2026-01-25",
      endDate: null,
      categoryId: null,
      dueDate: null,
      dueUnit: "month",
      dueInterval: 1,
      dueText: null,
      nextDueBy: null,
      archived: false,
      nextDueDate: "2026-01-25",
      scheduleText: "Every month on the 25th",
    });
    expect(await listItems(ann)).toEqual([created]);
  });

  it("fills in the optional fields", async () => {
    const created = await createItem(ann, internet());
    expect(created).toMatchObject({ description: "", recurrenceInterval: 1, endDate: null });
  });

  it("lists items by name regardless of case", async () => {
    await createItem(ann, internet({ name: "water" }));
    await createItem(ann, internet({ name: "Electric" }));
    await createItem(ann, internet({ name: "internet" }));
    expect((await listItems(ann)).map((item) => item.name)).toEqual(["Electric", "internet", "water"]);
  });

  it("updates only the fields sent", async () => {
    const created = await createItem(ann, internet({ description: "keep me" }));
    const response = await ann.patch(`/api/bills-income/${created.id}`, { name: "Fibre", recurrenceUnit: "week", recurrenceInterval: 2 });

    expect(response.status).toBe(200);
    expect((await response.json()).item).toMatchObject({
      name: "Fibre",
      description: "keep me",
      defaultAmountCents: 6000,
      recurrenceUnit: "week",
      recurrenceInterval: 2,
      scheduleText: "Every 2 weeks on Sunday",
    });
  });

  it("deletes an item", async () => {
    const created = await createItem(ann, internet());
    expect((await ann.delete(`/api/bills-income/${created.id}`)).status).toBe(204);
    expect(await listItems(ann)).toEqual([]);
    expect((await ann.delete(`/api/bills-income/${created.id}`)).status).toBe(404);
  });

  it.each([
    ["an empty name", { name: " " }, "name"],
    ["an overlong name", { name: "x".repeat(81) }, "name"],
    ["an overlong description", { description: "x".repeat(2001) }, "description"],
    ["an unknown kind", { kind: "gift" }, "kind"],
    ["a zero amount", { defaultAmountCents: 0 }, "defaultAmountCents"],
    ["a negative amount", { defaultAmountCents: -5 }, "defaultAmountCents"],
    ["an unknown unit", { recurrenceUnit: "day" }, "recurrenceUnit"],
    ["a zero interval", { recurrenceInterval: 0 }, "recurrenceInterval"],
    ["an interval over 52", { recurrenceInterval: 53 }, "recurrenceInterval"],
    ["a fractional interval", { recurrenceInterval: 1.5 }, "recurrenceInterval"],
    ["an impossible first due date", { firstDueDate: "2026-02-30" }, "firstDueDate"],
    ["an end date before the first due date", { endDate: "2026-01-24" }, "endDate"],
  ])("rejects %s", async (_label, overrides, field) => {
    for (const path of ["/api/bills-income", "/api/bills-income/preview"]) {
      const response = await ann.post(path, internet(overrides));
      expect(response.status).toBe(400);
      expect((await response.json()).error.fields).toHaveProperty(field);
    }
    expect(await listItems(ann)).toEqual([]);
  });

  it("checks a patched end date against the stored first due date", async () => {
    const created = await createItem(ann, internet());

    const tooEarly = await ann.patch(`/api/bills-income/${created.id}`, { endDate: "2026-01-01" });
    expect(tooEarly.status).toBe(400);
    expect((await tooEarly.json()).error.fields).toHaveProperty("endDate");

    expect((await ann.patch(`/api/bills-income/${created.id}`, { endDate: "2026-06-25" })).status).toBe(200);
    expect((await ann.patch(`/api/bills-income/${created.id}`, { endDate: null })).status).toBe(200);
    expect((await ann.patch(`/api/bills-income/${created.id}`, {})).status).toBe(400);
  });

  it("marks an item archived once its end date has passed", async () => {
    const created = await createItem(ann, internet({ endDate: "2026-01-25" }));
    expect(created.archived).toBe(false);

    t.clock.advance(10 * DAY); // Jan 25: the last day it applies
    expect((await listItems(ann))[0]).toMatchObject({ archived: false, nextDueDate: "2026-01-25" });

    t.clock.advance(1 * DAY);
    expect((await listItems(ann))[0]).toMatchObject({ archived: true, nextDueDate: null });
  });

  it("gives pay-period items no next due date", async () => {
    const created = await createItem(ann, internet({ recurrenceUnit: "period" }));
    expect(created).toMatchObject({ nextDueDate: null, scheduleText: "Every pay period" });
  });
});

describe("generating transactions", () => {
  it("adds a new item's occurrence to the existing period that contains it", async () => {
    const item = await createItem(ann, internet());

    expect(await generatedByPeriod(item.id)).toEqual([[], [], [["2026-01-25", -6000]], [], []]);
    const [generated] = await allGenerated(item.id);
    expect(generated).toMatchObject({ name: "Internet", status: "upcoming", occursAt: "2026-01-25T00:00", note: null });
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING - 6000, OPENING - 6000]);
  });

  it("adds exactly one per month as periods are generated out to the horizon", async () => {
    const item = await createItem(ann, internet());
    await ann.post("/api/periods/locate", { date: "2027-01-10" });

    const dates = (await allGenerated(item.id)).map((tx) => dateOf(tx.occursAt));
    expect(dates).toEqual([
      "2026-01-25", "2026-02-25", "2026-03-25", "2026-04-25", "2026-05-25", "2026-06-25",
      "2026-07-25", "2026-08-25", "2026-09-25", "2026-10-25", "2026-11-25", "2026-12-25",
    ]);
    await expectChainConsistent();
  });

  it("puts a pay-period income on the first day of the period containing its first due date, and each later one", async () => {
    const paycheck = await createItem(ann, {
      name: "Paycheck",
      kind: "income",
      defaultAmountCents: 185_000,
      recurrenceUnit: "period",
      firstDueDate: "2026-01-15", // mid-way through P2
    });

    expect(await generatedByPeriod(paycheck.id)).toEqual([
      [],
      [],
      [["2026-01-13", 185_000]],
      [["2026-01-27", 185_000]],
      [["2026-02-10", 185_000]],
    ]);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING + 185_000, OPENING + 370_000]);
  });

  it("derives each new period from the one before only after that one's items are in", async () => {
    await createItem(ann, { name: "Paycheck", kind: "income", defaultAmountCents: 185_000, recurrenceUnit: "period", firstDueDate: "2026-01-15" });
    await createItem(ann, internet({ name: "Groceries", recurrenceUnit: "week", defaultAmountCents: 12_000, firstDueDate: "2026-01-16" }));

    // Six more periods created in a single request.
    await ann.post("/api/periods/locate", { date: "2026-05-15" });

    const all = await periods();
    expect(all.length).toBe(11);
    await expectChainConsistent();
    // Each generated period carries one paycheck and two weekly shops.
    expect(all.at(-1)!.startingCents - all.at(-2)!.startingCents).toBe(185_000 - 2 * 12_000);
  });

  it("back-fills earlier periods when the first due date is in the past", async () => {
    const item = await createItem(ann, internet({ recurrenceUnit: "week", defaultAmountCents: 1000, firstDueDate: "2026-01-05" }));

    // Mondays from Jan 5: one left in P1, then two per period.
    expect(await generatedByPeriod(item.id)).toEqual([
      [],
      [["2026-01-05", -1000], ["2026-01-12", -1000]],
      [["2026-01-19", -1000], ["2026-01-26", -1000]],
      [["2026-02-02", -1000], ["2026-02-09", -1000]],
      [["2026-02-16", -1000], ["2026-02-23", -1000]],
    ]);
    expect((await allGenerated(item.id)).every((tx) => tx.status === "upcoming")).toBe(true);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING - 2000, OPENING - 4000, OPENING - 6000]);
    await expectChainConsistent();
  });

  it("stops a back-fill's knock-on effect at a starting amount set by hand", async () => {
    const [, , , p3] = await periods();
    await t.store.periods.update(annId, p3!.id, { startingCents: 5000, startingMode: "manual" }, t.clock.now());

    await createItem(ann, internet({ recurrenceUnit: "week", defaultAmountCents: 1000, firstDueDate: "2026-01-05" }));

    // P2 feels P1's two; P3 is pinned; P4 feels only P3's own two.
    expect(await startings()).toEqual([OPENING, OPENING, OPENING - 2000, 5000, OPENING - 2000]);
  });

  it("skips occurrences that fall before the first period", async () => {
    const item = await createItem(ann, internet({ recurrenceUnit: "week", firstDueDate: "2025-12-01" }));
    const dates = (await allGenerated(item.id)).map((tx) => dateOf(tx.occursAt));

    // Mondays Dec 1, 8 and 15 predate the budget; Dec 22 is the first inside it.
    expect(dates[0]).toBe("2025-12-22");
    expect(dates.length).toBe(10);
  });

  it("adds nothing before a future first due date or after an end date", async () => {
    const future = await createItem(ann, internet({ name: "Later", recurrenceUnit: "week", firstDueDate: "2026-02-05" }));
    expect(await generatedByPeriod(future.id)).toEqual([[], [], [], [["2026-02-05", -6000]], [["2026-02-12", -6000], ["2026-02-19", -6000]]]);

    const ending = await createItem(ann, internet({ name: "Short", recurrenceUnit: "week", firstDueDate: "2026-01-15", endDate: "2026-01-29" }));
    expect((await allGenerated(ending.id)).map((tx) => dateOf(tx.occursAt))).toEqual(["2026-01-15", "2026-01-22", "2026-01-29"]);
  });

  it("previews exactly what creating will do, and writes nothing", async () => {
    const body = internet({ recurrenceUnit: "week", defaultAmountCents: 1000, firstDueDate: "2026-01-05" });
    const before = await startings();

    const preview = (await (await ann.post("/api/bills-income/preview", body)).json()) as BillOrIncomePreview;
    expect(preview).toEqual({ transactions: 8, periods: 4, pastPeriods: 1, earliestDate: "2026-01-05" });
    expect(await listItems(ann)).toEqual([]);
    expect(await generatedByPeriod()).toEqual([[], [], [], [], []]);
    expect(await startings()).toEqual(before);

    const item = await createItem(ann, body);
    const created = await generatedByPeriod(item.id);
    expect(created.flat().length).toBe(preview.transactions);
    expect(created.filter((rows) => rows.length > 0).length).toBe(preview.periods);
  });

  it("previews an item that lands only in the current period, or nowhere yet", async () => {
    const current = (await (await ann.post("/api/bills-income/preview", internet())).json()) as BillOrIncomePreview;
    expect(current).toEqual({ transactions: 1, periods: 1, pastPeriods: 0, earliestDate: "2026-01-25" });

    const later = (await (await ann.post("/api/bills-income/preview", internet({ firstDueDate: "2026-06-25" }))).json()) as BillOrIncomePreview;
    expect(later).toEqual({ transactions: 0, periods: 0, pastPeriods: 0, earliestDate: null });
  });
});

describe("generated transactions stand on their own", () => {
  it("are untouched when the item is edited, including its first due date", async () => {
    const item = await createItem(ann, internet());
    const before = await generatedByPeriod(item.id);
    const startingBefore = await startings();

    await ann.patch(`/api/bills-income/${item.id}`, { defaultAmountCents: 7500, name: "Fibre", firstDueDate: "2026-01-10", recurrenceUnit: "week" });

    expect(await generatedByPeriod(item.id)).toEqual(before);
    expect((await allGenerated(item.id))[0]!.name).toBe("Internet");
    expect(await startings()).toEqual(startingBefore);
  });

  it("use the item's new amount and name in periods generated afterwards", async () => {
    const item = await createItem(ann, internet());
    await ann.patch(`/api/bills-income/${item.id}`, { defaultAmountCents: 7500, name: "Fibre" });
    await ann.post("/api/periods/locate", { date: "2026-03-01" });

    const rows = await allGenerated(item.id);
    expect(rows.map((tx) => [tx.name, dateOf(tx.occursAt), tx.amountCents])).toEqual([
      ["Internet", "2026-01-25", -6000],
      ["Fibre", "2026-02-25", -7500],
    ]);
  });

  it("keep their own edits and are never generated twice", async () => {
    const item = await createItem(ann, internet());
    const [generated] = await allGenerated(item.id);

    await ann.patch(`/api/transactions/${generated!.id}`, { amountCents: 6431, occursAt: "2026-01-23T00:00" });
    await ann.post("/api/periods/locate", { date: "2026-04-01" });

    const january = (await allGenerated(item.id)).filter((tx) => tx.occursAt.startsWith("2026-01"));
    expect(january.map((tx) => [dateOf(tx.occursAt), tx.amountCents])).toEqual([["2026-01-23", -6431]]);
    await expectChainConsistent();
  });

  it("stay deleted once deleted", async () => {
    const item = await createItem(ann, internet());
    const [generated] = await allGenerated(item.id);

    expect((await ann.delete(`/api/transactions/${generated!.id}`)).status).toBe(204);
    await ann.get("/api/periods/current");
    await ann.post("/api/periods/locate", { date: "2026-03-01" });

    expect((await allGenerated(item.id)).map((tx) => dateOf(tx.occursAt))).toEqual(["2026-02-25"]);
  });

  it("survive the item being deleted, without the link back", async () => {
    const item = await createItem(ann, internet());
    const startingBefore = await startings();

    expect((await ann.delete(`/api/bills-income/${item.id}`)).status).toBe(204);

    const [, , p2] = await periods();
    const orphan = (await viewOf(p2!)).transactions[0];
    expect(orphan).toMatchObject({ name: "Internet", amountCents: -6000, billIncomeId: null });
    expect(await startings()).toEqual(startingBefore);

    // And nothing more is generated for it.
    await ann.post("/api/periods/locate", { date: "2026-03-01" });
    expect((await generatedByPeriod()).flat()).toEqual([]);
  });

  it("can be inserted only once per occurrence", async () => {
    const item = await createItem(ann, internet());
    const duplicate = {
      id: "dup",
      userId: annId,
      name: "Internet",
      amountCents: -6000,
      occursAt: "2026-01-25T00:00",
      status: "upcoming" as const,
      paidAt: null,
      sortOrder: 0,
      note: null,
      billIncomeId: item.id,
      occurrenceDate: "2026-01-25",
      importKey: null,
      categoryId: null,
      createdAt: t.clock.now(),
      updatedAt: t.clock.now(),
    };

    expect(await t.store.transactions.createIfAbsent(duplicate)).toBe(false);
    expect(await t.store.transactions.createIfAbsent({ ...duplicate, id: "new", occurrenceDate: "2026-03-25" })).toBe(true);
    expect(await t.store.transactions.findById(annId, "dup")).toBeNull();
  });
});

describe("ending an item", () => {
  const weekly = internet({ recurrenceUnit: "week", defaultAmountCents: 1000, firstDueDate: "2026-01-05" });

  it("stops it today and, when asked, removes its upcoming transactions after today", async () => {
    const item = await createItem(ann, weekly);
    const rows = await allGenerated(item.id);
    // One future occurrence has already been paid; it must survive.
    const paidFuture = rows.find((tx) => tx.occursAt.startsWith("2026-02-02"))!;
    await ann.patch(`/api/transactions/${paidFuture.id}`, { status: "paid" });

    const response = await ann.post(`/api/bills-income/${item.id}/end`, { removeUpcoming: true });
    expect(response.status).toBe(200);
    expect((await response.json()).item).toMatchObject({ endDate: "2026-01-15", archived: false });

    // Past ones (Jan 5, 12) stay; after today only the paid one is left.
    expect((await allGenerated(item.id)).map((tx) => dateOf(tx.occursAt))).toEqual(["2026-01-05", "2026-01-12", "2026-02-02"]);
    await expectChainConsistent();

    await ann.post("/api/periods/locate", { date: "2026-04-01" });
    expect((await allGenerated(item.id)).length).toBe(3);
  });

  it("leaves existing transactions alone when not asked to remove them", async () => {
    const item = await createItem(ann, weekly);
    const startingBefore = await startings();

    await ann.post(`/api/bills-income/${item.id}/end`, { removeUpcoming: false });

    expect((await allGenerated(item.id)).length).toBe(8);
    expect(await startings()).toEqual(startingBefore);
    await ann.post("/api/periods/locate", { date: "2026-04-01" });
    expect((await allGenerated(item.id)).length).toBe(8);
  });

  it("keeps an earlier end date and requires the option", async () => {
    const item = await createItem(ann, internet({ firstDueDate: "2025-12-20", endDate: "2026-01-02" }));

    expect((await ann.post(`/api/bills-income/${item.id}/end`, {})).status).toBe(400);
    const response = await ann.post(`/api/bills-income/${item.id}/end`, { removeUpcoming: true });
    expect((await response.json()).item).toMatchObject({ endDate: "2026-01-02", archived: true });
  });
});

describe("access control", () => {
  it("requires a session", async () => {
    const anonymous = t.client();
    expect((await anonymous.get("/api/bills-income")).status).toBe(401);
    expect((await anonymous.post("/api/bills-income", internet())).status).toBe(401);
    expect((await anonymous.post("/api/bills-income/preview", internet())).status).toBe(401);
    expect((await anonymous.patch("/api/bills-income/x", { name: "y" })).status).toBe(401);
    expect((await anonymous.delete("/api/bills-income/x")).status).toBe(401);
    expect((await anonymous.post("/api/bills-income/x/end", { removeUpcoming: true })).status).toBe(401);
  });

  it("keeps one user's items and their transactions out of another's reach", async () => {
    const item = await createItem(ann, internet());
    const bob = await signUp("bob");
    const bobId = (await t.store.users.findByUsername("bob"))!.id;

    expect(await listItems(bob)).toEqual([]);
    expect((await bob.patch(`/api/bills-income/${item.id}`, { name: "mine now" })).status).toBe(404);
    expect((await bob.delete(`/api/bills-income/${item.id}`)).status).toBe(404);
    expect((await bob.post(`/api/bills-income/${item.id}/end`, { removeUpcoming: true })).status).toBe(404);

    // Bob's periods got nothing from Ann's item, then or when generated later.
    await bob.post("/api/periods/locate", { date: "2026-04-01" });
    const bobPeriods = await t.store.periods.listFromSeq(bobId, 0);
    expect(bobPeriods.every((p) => p.startingCents === OPENING)).toBe(true);

    expect((await listItems(ann))[0]).toMatchObject({ name: "Internet", endDate: null });
    expect((await allGenerated(item.id)).length).toBe(1);
  });
});
