import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import type { BalanceOutlook } from "../../shared/outlook.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16 with $1,000.00:
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
//   P3 2026-01-27..02-09   P4 02-10..02-23   P5 02-24..03-09   P6 03-10..03-23   P7 03-24..04-06
// Setup creates P0 to P2; nothing after the current period exists until something asks,
// and the outlook only looks at periods that exist.
let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

const DAY = 24 * 60 * 60 * 1000;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  const setup = await client.post("/api/budget", {
    type: "biweekly",
    anchorDate: "2025-12-16",
    openingCents: 100_000,
    timezone: "UTC",
  });
  expect(setup.status).toBe(201);
  return client;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

async function outlook(client = ann): Promise<BalanceOutlook> {
  const response = await client.get("/api/periods/outlook");
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

async function addItem(body: Row, client = ann) {
  const response = await client.post("/api/bills-income", { recurrenceInterval: 1, ...body });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
}

async function spend(date: string, amountCents: number, client = ann) {
  const response = await client.post("/api/transactions", { name: "Spent", amountCents, kind: "expense", occursAt: `${date}T09:00` });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
}

async function locate(date: string, client = ann): Promise<string> {
  return (await (await client.post("/api/periods/locate", { date })).json()).periodId;
}

const periodCount = async (name = "ann") => {
  const user = await t.store.users.findByUsername(name);
  return (await t.store.periods.listFromSeq(user!.id, 0)).length;
};

const setWarnings = (body: Row, client = ann) => client.put("/api/settings/low-balance", body);

describe("the balance outlook", () => {
  it("leaves out periods that don't exist yet, and creates none", async () => {
    expect(await outlook()).toEqual({ settings: { lowBalanceCents: 20_000, periodsAhead: 5 }, periods: [] });
    expect(await periodCount()).toBe(3);

    const p4 = await locate("2026-02-10"); // creates P3 and P4
    const result = await outlook();
    expect(result.periods.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ["2026-01-27", "2026-02-09"],
      ["2026-02-10", "2026-02-23"],
    ]);
    expect(result.periods[1]).toMatchObject({ periodId: p4, projectedCents: 100_000, level: "ok" });
    expect(await periodCount()).toBe(5);
  });

  it("looks no further than the settings say, however many exist", async () => {
    await locate("2026-04-06"); // through P7
    expect((await outlook()).periods.map(({ startDate }) => startDate)).toEqual([
      "2026-01-27",
      "2026-02-10",
      "2026-02-24",
      "2026-03-10",
      "2026-03-24",
    ]);
    await locate("2026-05-01");
    expect((await outlook()).periods).toHaveLength(5);
  });

  it("uses what each period really holds, a starting amount set by hand included", async () => {
    const p4 = await locate("2026-02-10");
    await spend("2026-01-30", 20_000);
    const response = await ann.patch(`/api/periods/${p4}/starting`, { startingCents: 1_000, carryForward: true });
    expect(response.status).toBe(200);

    expect((await outlook()).periods.map(({ projectedCents, level }) => [projectedCents, level])).toEqual([
      [80_000, "ok"],
      [1_000, "low"],
    ]);
  });

  it("marks a period low below the amount set, and negative below zero", async () => {
    await addItem({ name: "Loan", kind: "expense", defaultAmountCents: 45_000, recurrenceUnit: "week", recurrenceInterval: 2, firstDueDate: "2026-01-27" });
    await locate("2026-03-24");
    expect((await outlook()).periods.map(({ projectedCents, level }) => [projectedCents, level])).toEqual([
      [55_000, "ok"],
      [10_000, "low"],
      [-35_000, "negative"],
      [-80_000, "negative"],
      [-125_000, "negative"],
    ]);
  });

  it("starts after whichever period is current", async () => {
    await locate("2026-02-24");
    t.clock.advance(14 * DAY); // 2026-01-29: P3 is current
    expect((await outlook()).periods.map(({ startDate }) => startDate)).toEqual(["2026-02-10", "2026-02-24"]);
  });
});

describe("low balance settings", () => {
  it("change the amount and how far ahead, and 0 periods turns the warnings off", async () => {
    const saved = await setWarnings({ lowBalanceCents: 50_000, periodsAhead: 2 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ settings: { lowBalanceCents: 50_000, periodsAhead: 2 } });

    await locate("2026-03-01");
    await spend("2026-01-20", 60_000);
    const result = await outlook();
    expect(result.settings).toEqual({ lowBalanceCents: 50_000, periodsAhead: 2 });
    expect(result.periods.map(({ projectedCents, level }) => [projectedCents, level])).toEqual([
      [40_000, "low"],
      [40_000, "low"],
    ]);

    expect((await setWarnings({ lowBalanceCents: 50_000, periodsAhead: 0 })).status).toBe(200);
    expect(await outlook()).toEqual({ settings: { lowBalanceCents: 50_000, periodsAhead: 0 }, periods: [] });
  });

  it("go up to ten periods, never negative amounts", async () => {
    expect((await setWarnings({ lowBalanceCents: 0, periodsAhead: 10 })).status).toBe(200);
    await locate("2026-08-01");
    expect((await outlook()).periods).toHaveLength(10);

    for (const [body, field] of [
      [{ lowBalanceCents: 20_000, periodsAhead: 11 }, "periodsAhead"],
      [{ lowBalanceCents: 20_000, periodsAhead: -1 }, "periodsAhead"],
      [{ lowBalanceCents: 20_000, periodsAhead: 2.5 }, "periodsAhead"],
      [{ lowBalanceCents: -1, periodsAhead: 5 }, "lowBalanceCents"],
      [{ lowBalanceCents: 12.5, periodsAhead: 5 }, "lowBalanceCents"],
      [{ periodsAhead: 5 }, "lowBalanceCents"],
    ] as const) {
      const response = await setWarnings(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error.fields).toHaveProperty(field);
    }
    expect((await outlook()).settings).toEqual({ lowBalanceCents: 0, periodsAhead: 10 });
  });

  it("need a budget and a session", async () => {
    const carol = t.client();
    await carol.post("/api/auth/register", { username: "carol", email: "carol@example.com", password: "correct horse" });
    expect((await carol.get("/api/periods/outlook")).status).toBe(409);
    expect((await setWarnings({ lowBalanceCents: 0, periodsAhead: 1 }, carol)).status).toBe(409);

    expect((await t.client().get("/api/periods/outlook")).status).toBe(401);
    expect((await setWarnings({ lowBalanceCents: 0, periodsAhead: 1 }, t.client())).status).toBe(401);
  });
});

describe("another user", () => {
  it("has settings and an outlook of their own", async () => {
    const bob = await signUp("bob");
    await setWarnings({ lowBalanceCents: 1, periodsAhead: 1 });
    await addItem({ name: "Rent", kind: "expense", defaultAmountCents: 200_000, recurrenceUnit: "month", firstDueDate: "2026-02-01" });
    await locate("2026-02-20");

    await locate("2026-02-20", bob);

    const bobs = await outlook(bob);
    expect(bobs.settings).toEqual({ lowBalanceCents: 20_000, periodsAhead: 5 });
    expect(bobs.periods.map(({ projectedCents }) => projectedCents)).toEqual([100_000, 100_000]);
    expect((await outlook()).periods).toEqual([
      expect.objectContaining({ projectedCents: -100_000, level: "negative" }),
    ]);
  });
});

// The home screen's own figure and the outlook's must agree for a period that exists.
it("reports a generated period's projected leftover as its view does", async () => {
  const p3 = await locate("2026-01-27");
  await spend("2026-01-28", 7_777);
  const view: PeriodView = await (await ann.get(`/api/periods/${p3}`)).json();
  expect((await outlook()).periods[0]).toMatchObject({ periodId: p3, projectedCents: view.totals.projectedCents });
});
