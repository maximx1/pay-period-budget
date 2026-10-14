import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Report } from "../../shared/reports.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z, a Thursday. Biweekly from 2025-12-16,
// generated through 2026-02-20, gives:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 2026-02-10..02-23
// A paycheck ($2,000) arrives on the first day of every period; rent ($900) is due on the
// 25th of each month, so in P0 and P2 and next in the period after P4.
const OPENING = 100_000;

let t: TestApp;
let ann: Client;
let bob: Client;
let ids: { groceries: string; fun: string; rent: string; paycheck: string; savings: string };
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: OPENING, timezone: "UTC" });
  expect((await client.post("/api/periods/locate", { date: "2026-02-20" })).status).toBe(200);
  return client;
}

async function post(client: Client, path: string, body: Row) {
  const response = await client.post(path, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return response.json();
}

const spend = (client: Client, name: string, date: string, amountCents: number, overrides: Row = {}) =>
  post(client, "/api/transactions", { name, amountCents, kind: "expense", occursAt: `${date}T00:00`, paid: true, ...overrides });

async function report(client: Client, from: string, to: string): Promise<Report> {
  const response = await client.get(`/api/reports?from=${from}&to=${to}`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  bob = await signUp("bob");

  const groceries = (await post(ann, "/api/categories", { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true })).category.id;
  const fun = (await post(ann, "/api/categories", { name: "Fun" })).category.id;
  const item = async (body: Row) => (await post(ann, "/api/bills-income", body)).item.id as string;
  const rent = await item({ name: "Rent", kind: "expense", defaultAmountCents: 90_000, recurrenceUnit: "month", firstDueDate: "2025-12-25" });
  const paycheck = await item({ name: "Paycheck", kind: "income", defaultAmountCents: 200_000, recurrenceUnit: "period", firstDueDate: "2025-12-16" });
  const savings = await item({ name: "Savings", kind: "transfer", defaultAmountCents: 0, recurrenceUnit: "none" });
  ids = { groceries, fun, rent, paycheck, savings };

  await spend(ann, "Kroger", "2025-12-20", 5_000, { categoryId: groceries });
  await spend(ann, "KROGER", "2025-12-22", 3_000, { categoryId: groceries });
  await spend(ann, "Cinema", "2026-01-03", 2_500, { categoryId: fun });
  await spend(ann, "To savings", "2026-01-05", 10_000, { billIncomeId: savings });
  await spend(ann, "kroger", "2026-01-14", 4_000, { categoryId: groceries });
  await spend(ann, "From savings", "2026-01-14", 2_500, { kind: "income", billIncomeId: savings });
  await spend(ann, "Gift", "2026-01-13", 1_000, { paid: false });

  await spend(bob, "Bob's boat", "2026-01-14", 999_900);
});
afterEach(() => t.cleanup());

describe("the report", () => {
  it("covers every pay period that shares a day with the span, whole", async () => {
    const one = await report(ann, "2026-01-01", "2026-01-01");
    expect(one.periods.map((period) => period.startDate)).toEqual(["2025-12-30"]);
    expect([one.from, one.to, one.today]).toEqual(["2025-12-30", "2026-01-12", "2026-01-15"]);

    const three = await report(ann, "2025-12-29", "2026-01-13");
    expect(three.periods.map((period) => [period.startDate, period.endDate, period.isCurrent, period.isFuture])).toEqual([
      ["2025-12-16", "2025-12-29", false, false],
      ["2025-12-30", "2026-01-12", false, false],
      ["2026-01-13", "2026-01-26", true, false],
    ]);
    expect((await report(ann, "2026-01-27", "2026-12-31")).periods.map((period) => period.isFuture)).toEqual([true, true]);

    // A span no period reaches is an empty report, not an error.
    const none = await report(ann, "2024-01-01", "2024-02-01");
    expect(none).toMatchObject({ from: "2024-01-01", to: "2024-02-01", periods: [], names: [], largest: [], unpaid: [] });
    expect(none.pace).toEqual({ current: null, usual: null });
  });

  it("adds up each period: income, expenses, what was committed, transfers, and where it ends", async () => {
    const { periods } = await report(ann, "2025-12-16", "2026-02-23");
    expect(
      periods.map(({ startingCents, incomeCents, expenseCents, billOutCents, transferOutCents, transferInCents, endingCents, count }) => ({
        startingCents,
        incomeCents,
        expenseCents,
        billOutCents,
        transferOutCents,
        transferInCents,
        endingCents,
        count,
      })),
    ).toEqual([
      { startingCents: 100_000, incomeCents: 200_000, expenseCents: 98_000, billOutCents: 90_000, transferOutCents: 0, transferInCents: 0, endingCents: 202_000, count: 4 },
      { startingCents: 202_000, incomeCents: 200_000, expenseCents: 12_500, billOutCents: 10_000, transferOutCents: 10_000, transferInCents: 0, endingCents: 389_500, count: 3 },
      { startingCents: 389_500, incomeCents: 202_500, expenseCents: 95_000, billOutCents: 90_000, transferOutCents: 0, transferInCents: 2_500, endingCents: 497_000, count: 5 },
      { startingCents: 497_000, incomeCents: 200_000, expenseCents: 0, billOutCents: 0, transferOutCents: 0, transferInCents: 0, endingCents: 697_000, count: 1 },
      { startingCents: 697_000, incomeCents: 200_000, expenseCents: 0, billOutCents: 0, transferOutCents: 0, transferInCents: 0, endingCents: 897_000, count: 1 },
    ]);
    // Each period ends where the next begins: the report agrees with the periods themselves.
    for (const [index, period] of periods.entries()) {
      if (periods[index + 1]) expect(period.endingCents).toBe(periods[index + 1]!.startingCents);
    }
  });

  it("splits each period by category and by bill or income, and sets spending against its limits", async () => {
    const { periods, categories, billsIncome } = await report(ann, "2025-12-16", "2026-01-26");
    const sorted = <T extends { outCents: number; inCents: number }>(rows: T[]) =>
      [...rows].sort((a, b) => b.outCents - a.outCents || b.inCents - a.inCents);

    expect(sorted(periods[0]!.categories)).toEqual([
      { categoryId: null, outCents: 90_000, inCents: 200_000 },
      { categoryId: ids.groceries, outCents: 8_000, inCents: 0 },
    ]);
    expect(sorted(periods[1]!.categories)).toEqual([
      { categoryId: null, outCents: 10_000, inCents: 200_000 },
      { categoryId: ids.fun, outCents: 2_500, inCents: 0 },
    ]);
    expect(sorted(periods[2]!.billsIncome)).toEqual([
      { billIncomeId: ids.rent, outCents: 90_000, inCents: 0 },
      { billIncomeId: null, outCents: 5_000, inCents: 0 },
      { billIncomeId: ids.paycheck, outCents: 0, inCents: 200_000 },
      { billIncomeId: ids.savings, outCents: 0, inCents: 2_500 },
    ]);
    // Limits were given to the current period and later ones only.
    expect(periods.map((period) => period.limits)).toEqual([
      [],
      [],
      [{ categoryId: ids.groceries, limitCents: 20_000, spentCents: 4_000 }],
    ]);

    expect(categories).toEqual([
      { id: ids.fun, name: "Fun" },
      { id: ids.groceries, name: "Groceries" },
    ]);
    // What each schedule comes to over the next twelve months.
    expect(billsIncome).toEqual([
      { id: ids.paycheck, name: "Paycheck", kind: "income", yearlyCents: 26 * 200_000 },
      { id: ids.rent, name: "Rent", kind: "expense", yearlyCents: 12 * 90_000 },
      { id: ids.savings, name: "Savings", kind: "transfer", yearlyCents: null },
    ]);
  });

  it("names where most went, the largest payments, and the days of the week", async () => {
    const { names, largest, weekdays } = await report(ann, "2025-12-16", "2026-01-26");
    // "Kroger", "KROGER" and "kroger" are one name, shown as it was last written.
    expect(names).toEqual([
      { name: "Rent", outCents: 180_000, count: 2 },
      { name: "kroger", outCents: 12_000, count: 3 },
      { name: "To savings", outCents: 10_000, count: 1 },
      { name: "Cinema", outCents: 2_500, count: 1 },
      { name: "Gift", outCents: 1_000, count: 1 },
    ]);
    expect(largest.map((tx) => [tx.name, tx.amountCents, tx.occursAt.slice(0, 10)])).toEqual([
      // Rent is the largest by far, but its schedule added it.
      ["To savings", -10_000, "2026-01-05"],
      ["Kroger", -5_000, "2025-12-20"],
      ["kroger", -4_000, "2026-01-14"],
      ["KROGER", -3_000, "2025-12-22"],
      ["Cinema", -2_500, "2026-01-03"],
      ["Gift", -1_000, "2026-01-13"],
    ]);
    // Monday first.
    expect(weekdays).toEqual([13_000, 1_000, 4_000, 90_000, 0, 7_500, 90_000]);
  });

  it("sets this period's running spending against the usual, up to today", async () => {
    const { pace } = await report(ann, "2025-12-16", "2026-01-26");
    // Jan 13, 14 and 15: the gift, then the groceries.
    expect(pace.current).toEqual([1_000, 5_000, 5_000]);
    // The average of the two periods before, day by day.
    expect(pace.usual).toHaveLength(14);
    expect([pace.usual![0], pace.usual![4], pace.usual![6], pace.usual![9], pace.usual![13]]).toEqual([0, 3_750, 10_250, 55_250, 55_250]);

    // Without the current period there is nothing to set against the usual.
    expect((await report(ann, "2025-12-16", "2026-01-12")).pace.current).toBeNull();
    // And with nothing before it there is no usual.
    expect((await report(ann, "2026-01-13", "2026-01-26")).pace.usual).toBeNull();
  });

  it("lists what is still marked upcoming from before today, and what the schedules bring next", async () => {
    const { unpaid, ahead } = await report(ann, "2025-12-16", "2026-02-23");
    expect(unpaid.map((tx) => [tx.name, tx.occursAt.slice(0, 10)])).toEqual([
      ["Paycheck", "2025-12-16"],
      ["Rent", "2025-12-25"],
      ["Paycheck", "2025-12-30"],
      ["Paycheck", "2026-01-13"],
      ["Gift", "2026-01-13"],
    ]);
    // The six periods after the current one, two of which exist already.
    expect(ahead).toEqual([
      { startDate: "2026-01-27", endDate: "2026-02-09", billsCents: 0, incomeCents: 200_000 },
      { startDate: "2026-02-10", endDate: "2026-02-23", billsCents: 0, incomeCents: 200_000 },
      { startDate: "2026-02-24", endDate: "2026-03-09", billsCents: 90_000, incomeCents: 200_000 },
      { startDate: "2026-03-10", endDate: "2026-03-23", billsCents: 0, incomeCents: 200_000 },
      { startDate: "2026-03-24", endDate: "2026-04-06", billsCents: 90_000, incomeCents: 200_000 },
      { startDate: "2026-04-07", endDate: "2026-04-20", billsCents: 0, incomeCents: 200_000 },
    ]);
    // Looking ahead creates nothing.
    expect((await (await ann.get("/api/periods")).json()).periods).toHaveLength(5);
  });

  it("is only ever about the asker's own budget", async () => {
    const bobs = await report(bob, "2025-12-16", "2026-02-23");
    expect(bobs.names).toEqual([{ name: "Bob's boat", outCents: 999_900, count: 1 }]);
    expect(bobs.categories).toEqual([]);
    expect(bobs.billsIncome).toEqual([]);
    expect(bobs.periods.every((period) => period.limits.length === 0)).toBe(true);
    expect(bobs.periods.reduce((sum, period) => sum + period.incomeCents, 0)).toBe(0);

    const anns = await report(ann, "2025-12-16", "2026-02-23");
    expect(anns.names.some((entry) => entry.name === "Bob's boat")).toBe(false);
    expect((await t.client().get("/api/reports?from=2026-01-01&to=2026-01-31")).status).toBe(401);
  });

  it("refuses a span that is not two dates in order, and says so when there is no budget yet", async () => {
    expect((await ann.get("/api/reports")).status).toBe(400);
    expect((await ann.get("/api/reports?from=2026-01-01")).status).toBe(400);
    expect((await ann.get("/api/reports?from=2026-02-01&to=2026-01-01")).status).toBe(400);
    expect((await ann.get("/api/reports?from=soon&to=later")).status).toBe(400);

    const cat = t.client();
    await cat.post("/api/auth/register", { username: "cat", email: "cat@example.com", password: "correct horse" });
    expect((await cat.get("/api/reports?from=2026-01-01&to=2026-01-31")).status).toBe(409);
  });
});
