import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import { DUE_ONLY_FOR_MONEY_OUT_MESSAGE, type BillOrIncome } from "../../shared/billsIncome.ts";
import { LATE_NEEDS_ITEM_MESSAGE, type Transaction } from "../../shared/transactions.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, generated through
// 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// A card due on the 20th of each month is due in P2 (Jan 20) and P4 (Feb 20).
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

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

/** Paid as it happens, and due on the 20th of each month from January. */
const card = (overrides: Row = {}): Row => ({
  name: "Visa",
  kind: "expense",
  defaultAmountCents: 0,
  recurrenceUnit: "none",
  dueDate: "2026-01-20",
  ...overrides,
});

async function addItem(client: Client, body: Row): Promise<BillOrIncome> {
  const response = await client.post("/api/bills-income", body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

async function pay(client: Client, item: BillOrIncome, date: string, overrides: Row = {}): Promise<Transaction> {
  const response = await client.post("/api/transactions", {
    name: "Card payment",
    amountCents: 25_000,
    kind: "expense",
    occursAt: `${date}T09:00`,
    billIncomeId: item.id,
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction;
}

async function viewOn(client: Client, date: string): Promise<PeriodView> {
  const { periodId } = await (await client.post("/api/periods/locate", { date })).json();
  return (await client.get(`/api/periods/${periodId}`)).json();
}

const noticesOn = async (date: string, client = ann) => (await viewOn(client, date)).dueNotices;

describe("a bill's due date", () => {
  it("is saved with the item and described", async () => {
    const item = await addItem(ann, card());
    expect(item).toMatchObject({
      dueDate: "2026-01-20",
      dueUnit: "month",
      dueInterval: 1,
      dueText: "Due every month on the 20th",
      nextDueBy: "2026-01-20",
    });
  });

  it("repeats weekly or yearly too, every so many", async () => {
    const item = await addItem(ann, card({ dueDate: "2026-01-02", dueUnit: "week", dueInterval: 2 }));
    expect(item).toMatchObject({ dueText: "Due every 2 weeks on Friday", nextDueBy: "2026-01-16" });
    const yearly = await addItem(ann, card({ name: "Licence", dueDate: "2025-03-01", dueUnit: "year" }));
    expect(yearly).toMatchObject({ dueText: "Due every year on Mar 1", nextDueBy: "2026-03-01" });
  });

  it("is optional", async () => {
    const item = await addItem(ann, card({ dueDate: undefined }));
    expect(item).toMatchObject({ dueDate: null, dueText: null, nextDueBy: null });
  });

  it("belongs to a bill or a transfer, never an income", async () => {
    await addItem(ann, card({ kind: "transfer" }));
    const income = await ann.post("/api/bills-income", card({ kind: "income" }));
    expect(income.status).toBe(400);
    expect((await income.json()).error.fields).toEqual({ dueDate: DUE_ONLY_FOR_MONEY_OUT_MESSAGE });
  });

  it("must be given up to turn a bill into an income", async () => {
    const item = await addItem(ann, card());
    const refused = await ann.patch(`/api/bills-income/${item.id}`, { kind: "income" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.fields).toEqual({ dueDate: DUE_ONLY_FOR_MONEY_OUT_MESSAGE });

    const changed = await ann.patch(`/api/bills-income/${item.id}`, { kind: "income", dueDate: null });
    expect(changed.status).toBe(200);
    expect((await changed.json()).item).toMatchObject({ kind: "income", dueDate: null, dueText: null });
  });

  it("can be changed and taken away", async () => {
    const item = await addItem(ann, card());
    const moved = await ann.patch(`/api/bills-income/${item.id}`, { dueDate: "2026-01-05", dueUnit: "week" });
    expect((await moved.json()).item).toMatchObject({ dueText: "Due every week on Monday", nextDueBy: "2026-01-19" });
    const removed = await ann.patch(`/api/bills-income/${item.id}`, { dueDate: null });
    expect((await removed.json()).item).toMatchObject({ dueDate: null, nextDueBy: null });
    expect(await noticesOn("2026-01-20")).toEqual([]);
  });
});

describe("the pay period a due date falls in", () => {
  it("warns when nothing is set to pay it", async () => {
    const item = await addItem(ann, card());
    expect(await noticesOn("2026-01-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-01-20", lateDate: null, unpaidDate: null, urgent: false },
    ]);
    expect(await noticesOn("2026-02-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-02-20", lateDate: null, unpaidDate: null, urgent: false },
    ]);
    // Neither the period before the first due date nor one with no due date in it warns.
    expect(await noticesOn("2026-01-05")).toEqual([]);
    expect(await noticesOn("2026-02-01")).toEqual([]);
  });

  it("is satisfied by an upcoming or a paid payment on or before the day", async () => {
    const item = await addItem(ann, card());
    await pay(ann, item, "2026-01-16");
    await pay(ann, item, "2026-02-20", { paid: true });
    expect(await noticesOn("2026-01-20")).toEqual([]);
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });

  it("counts a payment in an earlier period, after the due date before", async () => {
    const item = await addItem(ann, card());
    await pay(ann, item, "2026-01-30"); // P3, for Feb 20 in P4
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });

  it("names a payment dated after the day it is due", async () => {
    const item = await addItem(ann, card());
    await pay(ann, item, "2026-01-23");
    expect(await noticesOn("2026-01-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-01-20", lateDate: "2026-01-23", unpaidDate: null, urgent: false },
    ]);
  });

  it("counts only money out tied to the item", async () => {
    const item = await addItem(ann, card());
    await pay(ann, item, "2026-01-16", { kind: "income", name: "Refund" });
    await pay(ann, item, "2026-01-17", { billIncomeId: null });
    expect(await noticesOn("2026-01-20")).toHaveLength(1);
  });

  it("is quiet when the item's own schedule pays it on time", async () => {
    await addItem(ann, card({ defaultAmountCents: 25_000, recurrenceUnit: "month", firstDueDate: "2026-01-15" }));
    expect(await noticesOn("2026-01-20")).toEqual([]);
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });

  it("stops when the item ends", async () => {
    await addItem(ann, card({ endDate: "2026-02-01" }));
    expect(await noticesOn("2026-01-20")).toHaveLength(1);
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });

  it("lists them by date, then name", async () => {
    await addItem(ann, card({ name: "Visa", dueDate: "2026-01-22" }));
    await addItem(ann, card({ name: "Amex", dueDate: "2026-01-22" }));
    await addItem(ann, card({ name: "Water", dueDate: "2026-01-14" }));
    expect((await noticesOn("2026-01-20")).map((notice) => notice.name)).toEqual(["Water", "Amex", "Visa"]);
  });

  it("never shows another user's bills", async () => {
    await addItem(ann, card());
    const bob = await signUp("bob");
    expect(await noticesOn("2026-01-20", bob)).toEqual([]);
  });
});

describe("a payment marked late", () => {
  it("pays the due date before it, so the next one warns", async () => {
    const item = await addItem(ann, card());
    const payment = await pay(ann, item, "2026-01-23");
    // Unmarked, Jan 23 is late for Jan 20 and counts toward Feb 20.
    expect(await noticesOn("2026-02-20")).toEqual([]);

    const marked = await ann.patch(`/api/transactions/${payment.id}`, { latePayment: true });
    expect(marked.status).toBe(200);
    expect((await marked.json()).transaction.latePayment).toBe(true);
    expect(await noticesOn("2026-02-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-02-20", lateDate: null, unpaidDate: null, urgent: false },
    ]);
    // Jan 20 still names it as late.
    expect(await noticesOn("2026-01-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-01-20", lateDate: "2026-01-23", unpaidDate: null, urgent: false },
    ]);

    await ann.patch(`/api/transactions/${payment.id}`, { latePayment: false });
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });

  it("can be marked when it is added", async () => {
    const item = await addItem(ann, card());
    const payment = await pay(ann, item, "2026-01-23", { latePayment: true });
    expect(payment.latePayment).toBe(true);
    expect(await noticesOn("2026-02-20")).toHaveLength(1);
  });

  it("is not late unless it is tied to an item", async () => {
    const untied = await ann.post("/api/transactions", {
      name: "Card payment",
      amountCents: 25_000,
      kind: "expense",
      occursAt: "2026-01-23T09:00",
      latePayment: true,
    });
    expect(untied.status).toBe(400);
    expect((await untied.json()).error.fields).toEqual({ latePayment: LATE_NEEDS_ITEM_MESSAGE });

    const item = await addItem(ann, card());
    const payment = await pay(ann, item, "2026-01-23", { latePayment: true });
    const unmarked = await ann.patch(`/api/transactions/${payment.id}`, { billIncomeId: null });
    expect((await unmarked.json()).transaction.latePayment).toBe(false);
    const refused = await ann.patch(`/api/transactions/${payment.id}`, { latePayment: true });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.fields).toEqual({ latePayment: LATE_NEEDS_ITEM_MESSAGE });
  });

  it("cannot be marked on another user's payment", async () => {
    const item = await addItem(ann, card());
    const payment = await pay(ann, item, "2026-01-23");
    const bob = await signUp("bob");
    expect((await bob.patch(`/api/transactions/${payment.id}`, { latePayment: true })).status).toBe(404);
    expect(await noticesOn("2026-02-20")).toEqual([]);
  });
});

describe("a due date close at hand", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("warns urgently from three days before when nothing is set to pay it", async () => {
    const item = await addItem(ann, card());
    // Jan 15 is five days out: an ordinary warning.
    expect(await noticesOn("2026-01-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-01-20", lateDate: null, unpaidDate: null, urgent: false },
    ]);
    t.clock.advance(2 * DAY); // Jan 17
    expect((await noticesOn("2026-01-20"))[0]).toMatchObject({ urgent: true });
  });

  it("warns urgently when its payment is set but not marked paid", async () => {
    const item = await addItem(ann, card());
    const payment = await pay(ann, item, "2026-01-19");
    expect(await noticesOn("2026-01-20")).toEqual([]);

    t.clock.advance(3 * DAY); // Jan 18
    expect(await noticesOn("2026-01-20")).toEqual([
      { billIncomeId: item.id, name: "Visa", dueDate: "2026-01-20", lateDate: null, unpaidDate: "2026-01-19", urgent: true },
    ]);

    expect((await ann.patch(`/api/transactions/${payment.id}`, { status: "paid" })).status).toBe(200);
    expect(await noticesOn("2026-01-20")).toEqual([]);
  });
});
