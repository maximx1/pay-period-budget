import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BalanceHistoryResponse, BalancesResponse, TrackedBalance } from "../../shared/balances.ts";
import type { BillOrIncome } from "../../shared/billsIncome.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z, and the budget is in UTC, so "now" is
// 2026-01-15T12:00. The test app's random is 0.5: every next check is exactly its interval away.
const DAY = 24 * 60 * 60 * 1000;
let t: TestApp;
let ann: Client;
type Client = ReturnType<TestApp["client"]>;
type Row = Record<string, unknown>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  return client;
}

async function addItem(client: Client, name: string, overrides: Row = {}): Promise<BillOrIncome> {
  const response = await client.post("/api/bills-income", {
    name,
    kind: "expense",
    defaultAmountCents: 0,
    recurrenceUnit: "none",
    ...overrides,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).item;
}

async function track(client: Client, id: string, body: Row): Promise<TrackedBalance> {
  const response = await client.post(`/api/balances/${id}`, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).balance;
}

async function list(client: Client): Promise<BalancesResponse> {
  const response = await client.get("/api/balances");
  expect(response.status).toBe(200);
  return response.json();
}

async function history(client: Client, id: string): Promise<BalanceHistoryResponse> {
  const response = await client.get(`/api/balances/${id}`);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

const estimateOf = async (client: Client, id: string) => (await history(client, id)).balance.estimateCents;

async function pay(client: Client, billIncomeId: string, date: string, amountCents: number, kind: "expense" | "income" = "expense") {
  const response = await client.post("/api/transactions", {
    name: kind === "expense" ? "Payment" : "Drawn",
    amountCents,
    kind,
    occursAt: `${date}T00:00`,
    paid: true,
    billIncomeId,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction.id as string;
}

beforeEach(async () => {
  // Checks fall due a month apart: sessions must outlast that.
  t = await createTestApp({ SESSION_TTL_DAYS: "365" });
  ann = await signUp("ann");
});
afterEach(() => t.cleanup());

describe("tracking a balance", () => {
  it("starts from a check and moves with what is paid after it, and back when unpaid", async () => {
    const loan = await addItem(ann, "Car loan");
    const started = await track(ann, loan.id, { balanceCents: -1_000_000, aprBps: 2499 });
    expect(started).toMatchObject({
      name: "Car loan",
      estimateCents: -1_000_000,
      lastCheck: { balanceCents: -1_000_000, aprBps: 2499, asOf: "2026-01-15T12:00" },
      sinceCount: 0,
      // $10,000 at 24.99% for a month.
      monthlyInterestCents: 20_825,
      checkEveryDays: null,
      nextCheckOn: "2026-02-14",
      due: false,
    });

    // Paying $300 toward it after the check brings the debt down; a payment dated before
    // the check is taken to be in the figure already.
    const payment = await pay(ann, loan.id, "2026-01-16", 30_000);
    await pay(ann, loan.id, "2026-01-14", 30_000);
    expect(await estimateOf(ann, loan.id)).toBe(-970_000);

    expect((await ann.patch(`/api/transactions/${payment}`, { status: "upcoming" })).status).toBe(200);
    expect(await estimateOf(ann, loan.id)).toBe(-1_000_000);
    expect((await ann.patch(`/api/transactions/${payment}`, { status: "paid" })).status).toBe(200);
    expect(await estimateOf(ann, loan.id)).toBe(-970_000);

    // The item's own totals say the same.
    const totals = (await (await ann.get(`/api/bills-income/${loan.id}/transactions`)).json()).totals;
    expect(totals.balanceCents).toBe(-970_000);
  });

  it("counts money taken back out of a savings transfer against it", async () => {
    const savings = await addItem(ann, "Savings", { kind: "transfer" });
    await track(ann, savings.id, { balanceCents: 500_000, aprBps: 400 });
    await pay(ann, savings.id, "2026-01-16", 20_000);
    await pay(ann, savings.id, "2026-01-17", 5_000, "income");
    const { balance, since } = await history(ann, savings.id);
    expect(balance.estimateCents).toBe(515_000);
    expect(balance.monthlyInterestCents).toBe(1_717);
    expect(since.map((row) => row.amountCents)).toEqual([-20_000, 5_000]);
  });

  it("takes a new check, keeping the rate unless told otherwise, and never a time ahead of now", async () => {
    const card = await addItem(ann, "Visa");
    await track(ann, card.id, { balanceCents: -250_000, aprBps: 2299 });
    await pay(ann, card.id, "2026-01-15", 10_000);

    let response = await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -260_000, asOf: "2026-01-15T13:00" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({ asOf: "That's later than now" });

    t.clock.advance(DAY);
    response = await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -260_000 });
    expect(response.status).toBe(201);
    expect((await response.json()).balance).toMatchObject({
      estimateCents: -260_000,
      lastCheck: { balanceCents: -260_000, aprBps: 2299, asOf: "2026-01-16T12:00" },
      sinceCount: 0,
      nextCheckOn: "2026-02-15",
    });

    await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -260_000, aprBps: null, asOf: "2026-01-16T09:00" });
    const { checks } = await history(ann, card.id);
    expect(checks.map((check) => [check.asOf, check.aprBps])).toEqual([
      ["2026-01-16T12:00", 2299],
      ["2026-01-16T09:00", null],
      ["2026-01-15T12:00", 2299],
    ]);
  });

  it("records the estimate as a check when it looks right", async () => {
    const loan = await addItem(ann, "Loan");
    await track(ann, loan.id, { balanceCents: -100_000, aprBps: 500 });
    await pay(ann, loan.id, "2026-01-16", 10_000);
    t.clock.advance(2 * DAY);
    const response = await ann.post(`/api/balances/${loan.id}/looks-right`);
    expect(response.status).toBe(201);
    expect((await response.json()).balance.lastCheck).toMatchObject({ balanceCents: -90_000, aprBps: 500, asOf: "2026-01-17T12:00" });
  });

  it("is only for a bill or a transfer, once, and keeps an item from becoming an income while tracked", async () => {
    const pay = await addItem(ann, "Paycheck", { kind: "income" });
    let response = await ann.post(`/api/balances/${pay.id}`, { balanceCents: 0 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({ billIncomeId: "Only a bill or a transfer can track a balance" });

    const loan = await addItem(ann, "Loan");
    await track(ann, loan.id, { balanceCents: -100 });
    expect((await ann.post(`/api/balances/${loan.id}`, { balanceCents: -100 })).status).toBe(409);

    response = await ann.patch(`/api/bills-income/${loan.id}`, { kind: "income" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({ kind: "Stop tracking its balance first" });
    expect((await ann.delete(`/api/balances/${loan.id}`)).status).toBe(204);
    expect((await ann.patch(`/api/bills-income/${loan.id}`, { kind: "income" })).status).toBe(200);
  });

  it("keeps the checks when tracking stops, and shows them again when it starts", async () => {
    const loan = await addItem(ann, "Loan");
    await track(ann, loan.id, { balanceCents: -100_000 });
    expect((await ann.delete(`/api/balances/${loan.id}`)).status).toBe(204);
    expect((await list(ann)).balances).toEqual([]);
    expect((await ann.get(`/api/balances/${loan.id}`)).status).toBe(404);

    t.clock.advance(DAY);
    await track(ann, loan.id, { balanceCents: -90_000 });
    expect((await history(ann, loan.id)).checks.map((check) => check.balanceCents)).toEqual([-90_000, -100_000]);
  });

  it("deletes a check entered by mistake, but never the only one", async () => {
    const loan = await addItem(ann, "Loan");
    const { lastCheck: first } = await track(ann, loan.id, { balanceCents: -100_000 });
    let response = await ann.delete(`/api/balances/${loan.id}/checks/${first.id}`);
    expect(response.status).toBe(409);

    t.clock.advance(DAY);
    const typo = (await (await ann.post(`/api/balances/${loan.id}/checks`, { balanceCents: -1_000_000 })).json()).balance.lastCheck;
    response = await ann.delete(`/api/balances/${loan.id}/checks/${typo.id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).balance.estimateCents).toBe(-100_000);
  });

  it("asks on its own interval when given one, counted from the last check", async () => {
    const pension = await addItem(ann, "Pension", { kind: "transfer" });
    await track(ann, pension.id, { balanceCents: 4_000_000, checkEveryDays: 91 });
    expect((await history(ann, pension.id)).balance).toMatchObject({ checkEveryDays: 91, nextCheckOn: "2026-04-16" });

    const response = await ann.patch(`/api/balances/${pension.id}`, { checkEveryDays: null });
    expect((await response.json()).balance).toMatchObject({ checkEveryDays: null, nextCheckOn: "2026-02-14" });
    expect((await ann.patch(`/api/balances/${pension.id}`, { checkEveryDays: 45 })).status).toBe(400);
  });

  it("changes the last check's rate in place, without counting it as a check", async () => {
    const loan = await addItem(ann, "Car loan");
    await track(ann, loan.id, { balanceCents: -1_200_000, aprBps: 650, checkEveryDays: 91 });
    t.clock.advance(DAY);
    const before = (await history(ann, loan.id)).balance;

    let response = await ann.patch(`/api/balances/${loan.id}`, { aprBps: 725 });
    expect(response.status).toBe(200);
    expect((await response.json()).balance).toMatchObject({
      lastCheck: { id: before.lastCheck.id, balanceCents: -1_200_000, aprBps: 725, asOf: "2026-01-15T12:00" },
      monthlyInterestCents: 7_250,
      checkEveryDays: 91,
      nextCheckOn: before.nextCheckOn,
    });
    expect((await history(ann, loan.id)).checks).toHaveLength(1);

    response = await ann.patch(`/api/balances/${loan.id}`, { aprBps: null });
    expect((await response.json()).balance).toMatchObject({ lastCheck: { aprBps: null }, monthlyInterestCents: null });

    response = await ann.patch(`/api/balances/${loan.id}`, { aprBps: 100_000 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("aprBps");
  });

  it("changes only the latest check's rate", async () => {
    const card = await addItem(ann, "Card");
    await track(ann, card.id, { balanceCents: -250_000, aprBps: 2299 });
    t.clock.advance(DAY);
    await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -260_000 });

    await ann.patch(`/api/balances/${card.id}`, { aprBps: 2499 });
    const { checks } = await history(ann, card.id);
    expect(checks.map((check) => check.aprBps)).toEqual([2499, 2299]);
  });
});

describe("asking for checks", () => {
  it("asks about at most three a day, oldest due first, counting what was checked or snoozed that day", async () => {
    const ids: Record<string, string> = {};
    for (const name of ["Amex", "Boat loan", "Car loan", "Discover", "Equity line"]) {
      ids[name] = (await addItem(ann, name)).id;
      await track(ann, ids[name]!, { balanceCents: -100_000 });
    }
    const asked = async () => {
      const { asks, balances } = await list(ann);
      const names = new Map(balances.map((b) => [b.billIncomeId, b.name]));
      return asks.map((id) => names.get(id));
    };
    expect(await asked()).toEqual([]);

    // All five fall due on 2026-02-14.
    t.clock.advance(31 * DAY); // 2026-02-15
    expect(await asked()).toEqual(["Amex", "Boat loan", "Car loan"]);
    expect((await ann.post(`/api/balances/${ids.Amex}/checks`, { balanceCents: -90_000 })).status).toBe(201);
    expect((await ann.post(`/api/balances/${ids["Boat loan"]}/snooze`, { days: 3 })).status).toBe(200);
    expect(await asked()).toEqual(["Car loan"]);
    expect((await ann.post("/api/balances/snooze-today")).status).toBe(204);
    expect(await asked()).toEqual([]);

    // The next day starts a fresh three: the two never asked first, then the one put off a day.
    t.clock.advance(DAY);
    expect(await asked()).toEqual(["Discover", "Equity line", "Car loan"]);
    expect((await list(ann)).balances.find((b) => b.name === "Boat loan")).toMatchObject({ nextCheckOn: "2026-02-18", due: false });

    const response = await ann.put("/api/balances/settings", { checkEveryDays: 14, checksPerDay: 1 });
    expect(response.status).toBe(200);
    expect(await asked()).toEqual(["Discover"]);
    expect((await list(ann)).settings).toEqual({ checkEveryDays: 14, checksPerDay: 1 });
    expect((await ann.post(`/api/balances/${ids.Amex}/snooze`, { days: 2 })).status).toBe(400);
    expect((await ann.put("/api/balances/settings", { checkEveryDays: 14, checksPerDay: 6 })).status).toBe(400);
  });

  it("adds up what is owed and what is held", async () => {
    await track(ann, (await addItem(ann, "Loan")).id, { balanceCents: -300_000 });
    await track(ann, (await addItem(ann, "Card")).id, { balanceCents: -50_000 });
    await track(ann, (await addItem(ann, "Savings", { kind: "transfer" })).id, { balanceCents: 120_000 });
    const { totals, balances } = await list(ann);
    expect(totals).toEqual({ owedCents: 350_000, heldCents: 120_000 });
    expect(balances.map((b) => b.name)).toEqual(["Card", "Loan", "Savings"]);
  });
});

describe("a balance in parts", () => {
  const parts = (balance: TrackedBalance) => balance.parts.map(({ name, estimateCents, aprBps }) => [name, estimateCents, aprBps]);

  it("adds its parts up, and shares a payment out over them by balance", async () => {
    const loan = await addItem(ann, "Student loan");
    const started = await track(ann, loan.id, {
      parts: [
        { name: "1-01", balanceCents: -1_200_000, aprBps: 600 },
        { name: "1-02", balanceCents: -600_000, aprBps: 300 },
        { name: "1-03", balanceCents: -200_000 },
      ],
    });
    expect(started).toMatchObject({
      estimateCents: -2_000_000,
      // Weighted by balance among the parts with a rate: (12,000 x 6% + 6,000 x 3%) / 18,000.
      lastCheck: { balanceCents: -2_000_000, aprBps: 500 },
      // Each part's own: $60 and $15; 1-03 has no rate.
      monthlyInterestCents: 7_500,
    });
    expect(parts(started)).toEqual([
      ["1-01", -1_200_000, 600],
      ["1-02", -600_000, 300],
      ["1-03", -200_000, null],
    ]);

    await pay(ann, loan.id, "2026-01-16", 50_000);
    const { balance, checks } = await history(ann, loan.id);
    expect(balance.estimateCents).toBe(-1_950_000);
    // $500 over 60%, 30% and 10% of it.
    expect(parts(balance)).toEqual([
      ["1-01", -1_170_000, 600],
      ["1-02", -585_000, 300],
      ["1-03", -195_000, null],
    ]);
    expect(balance.monthlyInterestCents).toBe(5_850 + 1_463);
    expect(checks[0]!.parts.map((part) => [part.name, part.balanceCents])).toEqual([
      ["1-01", -1_200_000],
      ["1-02", -600_000],
      ["1-03", -200_000],
    ]);
  });

  it("keeps each part from check to check by its id, its rate carrying on when left out", async () => {
    const loan = await addItem(ann, "Student loan");
    const started = await track(ann, loan.id, {
      parts: [
        { name: "1-01", balanceCents: -100_000, aprBps: 600 },
        { name: "1-02", balanceCents: -50_000, aprBps: 300 },
      ],
    });
    const [first, second] = started.parts;
    t.clock.advance(DAY);

    // 1-02 is paid off and left out; 1-01 is renamed and keeps its rate; a new part joins.
    let response = await ann.post(`/api/balances/${loan.id}/checks`, {
      parts: [
        { id: first!.id, name: "Subsidized", balanceCents: -90_000 },
        { name: "Unsubsidized", balanceCents: -40_000, aprBps: 450 },
      ],
    });
    expect(response.status).toBe(201);
    const balance: TrackedBalance = (await response.json()).balance;
    expect(balance.parts.map(({ id, name, aprBps }) => [id, name, aprBps])).toEqual([
      [first!.id, "Subsidized", 600],
      [expect.any(String), "Unsubsidized", 450],
    ]);
    expect(balance.parts[1]!.id).not.toBe(second!.id);
    expect(balance.estimateCents).toBe(-130_000);

    // A part from an earlier check can come back by its id, with its rate from then.
    t.clock.advance(DAY);
    response = await ann.post(`/api/balances/${loan.id}/checks`, {
      parts: [{ id: second!.id, name: "1-02", balanceCents: -10_000 }],
    });
    expect((await response.json()).balance.parts).toMatchObject([{ id: second!.id, aprBps: 300 }]);

    response = await ann.post(`/api/balances/${loan.id}/checks`, { parts: [{ id: "nope", name: "X", balanceCents: -1 }] });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({ "parts.0.id": "No such part" });
    response = await ann.post(`/api/balances/${loan.id}/checks`, {
      parts: [
        { id: second!.id, name: "A", balanceCents: -1 },
        { id: second!.id, name: "B", balanceCents: -1 },
      ],
    });
    expect((await response.json()).error.fields).toEqual({ parts: "A part is listed twice" });
  });

  it("takes a check without parts only when told, and can be split up later", async () => {
    const card = await addItem(ann, "Loan");
    await track(ann, card.id, { balanceCents: -300_000, aprBps: 500 });
    t.clock.advance(DAY);
    let response = await ann.post(`/api/balances/${card.id}/checks`, {
      parts: [
        { name: "A", balanceCents: -200_000, aprBps: 500 },
        { name: "B", balanceCents: -100_000, aprBps: 500 },
      ],
    });
    expect((await response.json()).balance.parts).toHaveLength(2);

    response = await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -290_000 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("parts");

    response = await ann.post(`/api/balances/${card.id}/checks`, { balanceCents: -290_000, parts: [] });
    expect((await response.json()).balance).toMatchObject({ estimateCents: -290_000, parts: [], lastCheck: { aprBps: 500 } });
  });

  it("records every part at its estimate when it looks right", async () => {
    const loan = await addItem(ann, "Student loan");
    await track(ann, loan.id, {
      parts: [
        { name: "A", balanceCents: -300_000, aprBps: 400 },
        { name: "B", balanceCents: -100_000, aprBps: 800 },
      ],
    });
    await pay(ann, loan.id, "2026-01-16", 40_000);
    t.clock.advance(DAY);
    const response = await ann.post(`/api/balances/${loan.id}/looks-right`);
    expect(response.status).toBe(201);
    const balance: TrackedBalance = (await response.json()).balance;
    expect(balance).toMatchObject({ estimateCents: -360_000, sinceCount: 0, lastCheck: { balanceCents: -360_000, aprBps: 500 } });
    expect(parts(balance)).toEqual([
      ["A", -270_000, 400],
      ["B", -90_000, 800],
    ]);
  });

  it("renames a part or changes its rate in place, and refuses a rate for the whole", async () => {
    const loan = await addItem(ann, "Student loan");
    const started = await track(ann, loan.id, {
      parts: [
        { name: "A", balanceCents: -300_000, aprBps: 400 },
        { name: "B", balanceCents: -100_000, aprBps: 400 },
      ],
    });
    const b = started.parts[1]!;

    let response = await ann.patch(`/api/balances/${loan.id}/parts/${b.id}`, { name: "Unsub", aprBps: 800 });
    expect(response.status).toBe(200);
    expect((await response.json()).balance).toMatchObject({
      lastCheck: { id: started.lastCheck.id, aprBps: 500 },
      parts: [{ name: "A" }, { id: b.id, name: "Unsub", aprBps: 800 }],
      nextCheckOn: started.nextCheckOn,
    });
    expect((await history(ann, loan.id)).checks).toHaveLength(1);

    response = await ann.patch(`/api/balances/${loan.id}/parts/${b.id}`, { name: "a" });
    expect((await response.json()).error.fields).toEqual({ name: "Another part has this name" });
    expect((await ann.patch(`/api/balances/${loan.id}/parts/nope`, { aprBps: 1 })).status).toBe(404);
    response = await ann.patch(`/api/balances/${loan.id}`, { aprBps: 100 });
    expect((await response.json()).error.fields).toEqual({ aprBps: "Change each part's rate instead" });
  });

  it("starts again from one figure after tracking stopped, whatever the old checks had", async () => {
    const loan = await addItem(ann, "Student loan");
    await track(ann, loan.id, { parts: [{ name: "A", balanceCents: -100 }] });
    expect((await ann.delete(`/api/balances/${loan.id}`)).status).toBe(204);
    expect(await track(ann, loan.id, { balanceCents: -90 })).toMatchObject({ estimateCents: -90, parts: [] });
  });
});

describe("another user", () => {
  it("can't see, track, check, snooze or stop someone else's balance", async () => {
    const loan = await addItem(ann, "Ann's loan");
    const { lastCheck } = await track(ann, loan.id, { balanceCents: -100_000 });
    const bob = await signUp("bob");

    expect((await list(bob)).balances).toEqual([]);
    for (const response of [
      await bob.get(`/api/balances/${loan.id}`),
      await bob.post(`/api/balances/${loan.id}`, { balanceCents: 0 }),
      await bob.patch(`/api/balances/${loan.id}`, { checkEveryDays: 14 }),
      await bob.patch(`/api/balances/${loan.id}`, { aprBps: 999 }),
      await bob.patch(`/api/balances/${loan.id}/parts/${lastCheck.id}`, { aprBps: 999 }),
      await bob.post(`/api/balances/${loan.id}/checks`, { balanceCents: 0 }),
      await bob.post(`/api/balances/${loan.id}/looks-right`),
      await bob.post(`/api/balances/${loan.id}/snooze`, { days: 1 }),
      await bob.delete(`/api/balances/${loan.id}/checks/${lastCheck.id}`),
      await bob.delete(`/api/balances/${loan.id}`),
    ]) {
      expect(response.status).toBe(404);
    }
    // Bob's own item, with Ann's check's id, is still not found.
    const bobs = await addItem(bob, "Bob's loan");
    await track(bob, bobs.id, { balanceCents: -1 });
    await bob.post(`/api/balances/${bobs.id}/checks`, { balanceCents: -2 });
    expect((await bob.delete(`/api/balances/${bobs.id}/checks/${lastCheck.id}`)).status).toBe(404);

    expect(await estimateOf(ann, loan.id)).toBe(-100_000);
    expect((await t.client().get("/api/balances")).status).toBe(401);
  });
});
