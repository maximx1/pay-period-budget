import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodListResponse, PeriodView } from "../../shared/budget.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// Clock starts 2026-01-15T12:00Z, UTC budget, biweekly from 2025-12-16:
//   P0 12-16..12-29   P1 12-30..01-12   P2 01-13..01-26 (current)
// One expense in each of P0 and P1 (1000 and 2000 cents), so the starting amounts run
//   100000, 99000, 97000.
// The periods before the budget began, when added, are
//   P-1 12-02..12-15   P-2 11-18..12-01
const OPENING = 100_000;
const BASE = [100_000, 99_000, 97_000];

let t: TestApp;
let ann: Client;
let annId: string;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: OPENING, timezone: "UTC" });
  return client;
}

async function spend(client: Client, date: string, amountCents: number): Promise<string> {
  const response = await client.post("/api/transactions", { name: "x", amountCents, kind: "expense", occursAt: `${date}T00:00` });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).transaction.id;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  annId = (await t.store.users.findByUsername("ann"))!.id;
  await spend(ann, "2025-12-20", 1000);
  await spend(ann, "2026-01-05", 2000);
  expect(await budgetStartings()).toEqual(BASE);
});
afterEach(() => t.cleanup());

const all = () => t.store.periods.listAll(annId);
const bySeq = async (seq: number) => (await all()).find((period) => period.seq === seq)!;
const starting = async (seq: number) => (await bySeq(seq)).startingCents;
/** Starting amounts from the budget's first period onward: what must never move. */
const budgetStartings = async () => (await all()).filter((period) => period.seq >= 0).map((period) => period.startingCents);
const view = async (client: Client, id: string) => (await (await client.get(`/api/periods/${id}`)).json()) as PeriodView;

async function addEarlier(client: Client = ann): Promise<PeriodView> {
  const response = await client.post("/api/periods/earlier");
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return view(client, (await response.json()).periodId);
}

/** Every period before the budget ends on exactly what the next one starts with. */
async function expectHistoryToJoinUp() {
  const periods = await all();
  for (const [index, period] of periods.entries()) {
    if (period.seq >= 0) break;
    const { totals } = await view(ann, period.id);
    expect(totals.projectedCents, `period ${period.seq} should end on period ${period.seq + 1}'s start`).toBe(
      periods[index + 1]!.startingCents,
    );
  }
}

describe("adding a period before the first one", () => {
  it("creates it on the schedule, back to back with the first, and links the two", async () => {
    const first = await bySeq(0);
    const earlier = await addEarlier();

    expect(earlier.period).toMatchObject({
      seq: -1,
      startDate: "2025-12-02",
      endDate: "2025-12-15",
      nominalStart: "2025-12-02",
      nominalEnd: "2025-12-15",
      datesEdited: false,
      isCurrent: false,
      startingCents: OPENING,
      startingMode: "auto",
      carryStale: false,
    });
    expect(earlier.totals.projectedCents).toBe(OPENING);
    expect(earlier.nav).toEqual({ prevId: null, canAddPrevious: true, nextId: first.id, nextDate: null });
    expect((await view(ann, first.id)).nav).toMatchObject({ prevId: earlier.period.id, canAddPrevious: false });
    expect(await budgetStartings()).toEqual(BASE);
  });

  it("goes back one period at a time", async () => {
    await addEarlier();
    const second = await addEarlier();

    expect(second.period).toMatchObject({ seq: -2, startDate: "2025-11-18", endDate: "2025-12-01" });
    expect((await all()).map((period) => period.seq)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("ends where the first period really starts when that was moved by hand", async () => {
    const first = await bySeq(0);
    expect((await ann.patch(`/api/periods/${first.id}/dates`, { startDate: "2025-12-18" })).status).toBe(200);

    const earlier = await addEarlier();
    expect(earlier.period).toMatchObject({ startDate: "2025-12-02", endDate: "2025-12-17", datesEdited: true });
  });

  it("stops a year back", async () => {
    // A year before 2026-01-15 falls in period -24 (2025-01-14..01-27).
    for (let added = 1; added <= 24; added++) await addEarlier();
    const earliest = (await all())[0]!;
    expect(earliest).toMatchObject({ seq: -24, startDate: "2025-01-14" });
    expect((await view(ann, earliest.id)).nav.canAddPrevious).toBe(false);

    const response = await ann.post("/api/periods/earlier");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("That's more than a year back");
    expect(await all()).toHaveLength(27);
  });

  it("appears in the list of periods, oldest first", async () => {
    const earlier = await addEarlier();
    const { periods } = (await (await ann.get("/api/periods")).json()) as PeriodListResponse;
    expect(periods[0]).toEqual({ id: earlier.period.id, startDate: "2025-12-02", endDate: "2025-12-15" });
    expect(periods).toHaveLength(4);
  });
});

describe("money in periods before the budget began", () => {
  it("never changes a starting amount from the first period onward", async () => {
    await addEarlier();
    await spend(ann, "2025-12-10", 500);

    expect(await budgetStartings()).toEqual(BASE);
    // It started with 500 more, so that it still ends on what the first period started with.
    expect(await starting(-1)).toBe(100_500);
    await expectHistoryToJoinUp();
  });

  it("moves the period itself and everything earlier, but nothing later", async () => {
    await addEarlier();
    await addEarlier();

    await spend(ann, "2025-12-10", 700);
    expect([await starting(-2), await starting(-1)]).toEqual([100_700, 100_700]);

    await spend(ann, "2025-11-20", 300);
    expect([await starting(-2), await starting(-1)]).toEqual([101_000, 100_700]);

    expect(await budgetStartings()).toEqual(BASE);
    await expectHistoryToJoinUp();
  });

  it("follows an amount being edited and a transaction being deleted", async () => {
    await addEarlier();
    await addEarlier();
    const id = await spend(ann, "2025-11-20", 300);

    expect((await ann.patch(`/api/transactions/${id}`, { amountCents: 900 })).status).toBe(200);
    expect([await starting(-2), await starting(-1)]).toEqual([100_900, 100_000]);
    await expectHistoryToJoinUp();

    expect((await ann.delete(`/api/transactions/${id}`)).status).toBe(204);
    expect([await starting(-2), await starting(-1)]).toEqual([100_000, 100_000]);
    expect(await budgetStartings()).toEqual(BASE);
  });

  it("follows a transaction moved between two earlier periods", async () => {
    await addEarlier();
    await addEarlier();
    const id = await spend(ann, "2025-11-20", 300);

    expect((await ann.patch(`/api/transactions/${id}`, { occursAt: "2025-12-10T00:00" })).status).toBe(200);

    expect([await starting(-2), await starting(-1)]).toEqual([100_300, 100_300]);
    expect(await budgetStartings()).toEqual(BASE);
    await expectHistoryToJoinUp();
  });

  it("treats a transaction moved into the budget like any other new one there", async () => {
    await addEarlier();
    const id = await spend(ann, "2025-12-10", 700);

    expect((await ann.patch(`/api/transactions/${id}`, { occursAt: "2025-12-20T00:00" })).status).toBe(200);

    // The first period keeps its starting amount; the 700 now comes off what follows it.
    expect(await budgetStartings()).toEqual([100_000, 98_300, 96_300]);
    expect(await starting(-1)).toBe(100_000);
    await expectHistoryToJoinUp();
  });

  it("follows days handed over when the first period's start is moved later", async () => {
    await addEarlier();
    const first = await bySeq(0);

    // 12-16..12-20 go to the earlier period, and the 1000 spent on the 20th with them.
    const response = await ann.patch(`/api/periods/${first.id}/dates`, { startDate: "2025-12-21" });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect((await response.json()).movedTransactions).toBe(1);

    expect(await budgetStartings()).toEqual([100_000, 100_000, 98_000]);
    expect(await starting(-1)).toBe(101_000);
    await expectHistoryToJoinUp();
  });

  it("still refuses a date before the earliest period", async () => {
    await addEarlier();
    const response = await ann.post("/api/transactions", { name: "x", amountCents: 100, kind: "expense", occursAt: "2025-12-01T00:00" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({ occursAt: "That's before your earliest pay period" });
    expect(await all()).toHaveLength(4);
  });
});

describe("the first period's starting amount and the history before it", () => {
  let firstId: string;
  let earlierId: string;
  beforeEach(async () => {
    earlierId = (await addEarlier()).period.id;
    firstId = (await bySeq(0)).id;
    await spend(ann, "2025-12-10", 500);
  });

  it("moves the history with it when set by hand", async () => {
    const response = await ann.patch(`/api/periods/${firstId}/starting`, { startingCents: 90_000, carryForward: true });
    expect(response.status).toBe(200);

    expect(await budgetStartings()).toEqual([90_000, 89_000, 87_000]);
    expect(await starting(-1)).toBe(90_500);
    await expectHistoryToJoinUp();
  });

  it("moves the history with it even when later periods are left alone", async () => {
    await ann.patch(`/api/periods/${firstId}/starting`, { startingCents: 90_000, carryForward: false });

    expect(await budgetStartings()).toEqual([90_000, 99_000, 97_000]);
    expect(await starting(-1)).toBe(90_500);
    expect((await bySeq(-1)).carryStale).toBe(false);
    await expectHistoryToJoinUp();
  });

  it("moves the history back when the calculated amount is restored", async () => {
    await ann.patch(`/api/periods/${firstId}/starting`, { startingCents: 90_000, carryForward: true });
    expect((await ann.post(`/api/periods/${firstId}/starting/revert`)).status).toBe(200);

    expect(await budgetStartings()).toEqual(BASE);
    expect(await starting(-1)).toBe(100_500);
    await expectHistoryToJoinUp();
  });

  it("does not let an earlier period's starting amount be set or reverted", async () => {
    const set = await ann.patch(`/api/periods/${earlierId}/starting`, { startingCents: 5, carryForward: true });
    expect(set.status).toBe(409);
    expect((await set.json()).error.message).toBe("Amounts before your budget started are worked out from its first period");
    expect((await ann.post(`/api/periods/${earlierId}/starting/revert`)).status).toBe(409);

    expect(await starting(-1)).toBe(100_500);
    expect(await budgetStartings()).toEqual(BASE);
  });
});

describe("recurring items and earlier periods", () => {
  const rent = { name: "Rent", kind: "expense", defaultAmountCents: 5000, recurrenceUnit: "month", firstDueDate: "2025-12-05" };

  it("fills in what was due in a period when it is added", async () => {
    // Due 12-05 (before the budget, so nothing yet) and 01-05 (P1).
    expect((await ann.post("/api/recurring", rent)).status).toBe(201);
    expect(await budgetStartings()).toEqual([100_000, 99_000, 92_000]);

    const earlier = await addEarlier();

    expect(earlier.transactions.map((tx) => [tx.name, tx.occursAt, tx.amountCents])).toEqual([["Rent", "2025-12-05T00:00", -5000]]);
    expect(earlier.period.startingCents).toBe(105_000);
    expect(await budgetStartings()).toEqual([100_000, 99_000, 92_000]);
    await expectHistoryToJoinUp();
  });

  it("back-fills an earlier period that already exists without touching the budget", async () => {
    await addEarlier();
    expect((await ann.post("/api/recurring", rent)).status).toBe(201);

    expect(await starting(-1)).toBe(105_000);
    expect(await budgetStartings()).toEqual([100_000, 99_000, 92_000]);
    await expectHistoryToJoinUp();
  });
});

describe("access control", () => {
  it("requires a session", async () => {
    expect((await t.client().post("/api/periods/earlier")).status).toBe(401);
  });

  it("adds only to the signed-in user's periods", async () => {
    const bob = await signUp("bob");
    const bobId = (await t.store.users.findByUsername("bob"))!.id;

    const earlier = await addEarlier(bob);

    expect((await all()).map((period) => period.seq)).toEqual([0, 1, 2]);
    expect((await t.store.periods.listAll(bobId)).map((period) => period.seq)).toEqual([-1, 0, 1, 2]);
    expect((await ann.get(`/api/periods/${earlier.period.id}`)).status).toBe(404);
  });
});
