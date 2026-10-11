import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetSetupInput, PeriodListResponse, PeriodView } from "../../shared/budget.ts";
import { addDays } from "../../shared/dates.ts";
import { horizonSeq, nominalPeriod } from "../../shared/schedule.ts";
import { createTestApp, type TestApp } from "../testing.ts";

const DAY = 24 * 60 * 60 * 1000;
// The test clock starts at 2026-01-15T12:00Z, so with a UTC budget "today" is 2026-01-15.
const TODAY = "2026-01-15";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.cleanup());

type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  const response = await client.post("/api/auth/register", {
    username: name,
    email: `${name}@example.com`,
    password: "correct horse",
  });
  expect(response.status).toBe(201);
  return client;
}

const biweekly: BudgetSetupInput = { type: "biweekly", anchorDate: addDays(TODAY, -30), openingCents: 125000, timezone: "UTC" };

async function setUp(client: Client, overrides: Partial<BudgetSetupInput> = {}) {
  const response = await client.post("/api/budget", { ...biweekly, ...overrides });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
}

/** Moves the clock forward in steps, touching the session so it doesn't expire on the way. */
async function advanceDays(client: Client, days: number) {
  for (let remaining = days; remaining > 0; remaining -= 10) {
    t.clock.advance(Math.min(remaining, 10) * DAY);
    expect((await client.get("/api/auth/me")).status).toBe(200);
  }
}

const current = async (client: Client) => (await (await client.get("/api/periods/current")).json()) as PeriodView;
const view = async (client: Client, id: string) => (await (await client.get(`/api/periods/${id}`)).json()) as PeriodView;
const userId = async (name: string) => (await t.store.users.findByUsername(name))!.id;
const allPeriods = async (name: string) => t.store.periods.listFromSeq(await userId(name), 0);

describe("budget setup", () => {
  it("reports no budget before setup, and the saved one after", async () => {
    const client = await signUp("ann");
    expect(await (await client.get("/api/budget")).json()).toEqual({ budget: null });

    await setUp(client);
    expect(await (await client.get("/api/budget")).json()).toEqual({ budget: biweekly });
  });

  it("creates every period from the anchor through today, back to back", async () => {
    const client = await signUp("ann");
    await setUp(client);

    const periods = await allPeriods("ann");
    expect(periods.map((p) => [p.seq, p.startDate, p.endDate])).toEqual([
      [0, "2025-12-16", "2025-12-29"],
      [1, "2025-12-30", "2026-01-12"],
      [2, "2026-01-13", "2026-01-26"],
    ]);

    const now = await current(client);
    expect(now.period).toMatchObject({ seq: 2, isCurrent: true, datesEdited: false, startingMode: "auto", carryStale: false });
    expect(now.period.nominalStart).toBe(now.period.startDate);
  });

  it("carries the opening balance into every generated period", async () => {
    const client = await signUp("ann");
    await setUp(client);

    expect((await allPeriods("ann")).map((p) => p.startingCents)).toEqual([125000, 125000, 125000]);
    expect((await current(client)).totals).toEqual({
      paidCents: 0,
      upcomingCents: 0,
      leftoverCents: 125000,
      projectedCents: 125000,
    });
  });

  it("defaults the opening balance to zero and accepts a negative one", async () => {
    const ann = await signUp("ann");
    const { openingCents: _, ...withoutOpening } = biweekly;
    expect((await ann.post("/api/budget", withoutOpening)).status).toBe(201);
    expect((await current(ann)).period.startingCents).toBe(0);

    const bob = await signUp("bob");
    await setUp(bob, { openingCents: -5000 });
    expect((await current(bob)).period.startingCents).toBe(-5000);
  });

  it("refuses a second setup", async () => {
    const client = await signUp("ann");
    await setUp(client);

    const again = await client.post("/api/budget", { ...biweekly, type: "weekly" });
    expect(again.status).toBe(409);
    expect((await (await client.get("/api/budget")).json()).budget.type).toBe("biweekly");
  });

  it.each([
    ["a start date in the future", { anchorDate: addDays(TODAY, 1) }, "anchorDate"],
    ["a start date more than a year back", { anchorDate: addDays(TODAY, -400) }, "anchorDate"],
    ["a date that doesn't exist", { anchorDate: "2026-02-30" }, "anchorDate"],
    ["an unknown schedule type", { type: "fortnightly" }, "type"],
    ["an unknown time zone", { timezone: "Mars/Olympus_Mons" }, "timezone"],
    ["a fractional opening balance", { openingCents: 10.5 }, "openingCents"],
  ])("rejects %s", async (_label, overrides, field) => {
    const client = await signUp("ann");
    const response = await client.post("/api/budget", { ...biweekly, ...overrides });

    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty(field);
    expect(await (await client.get("/api/budget")).json()).toEqual({ budget: null });
  });

  it("accepts today and exactly 366 days back as start dates", async () => {
    const ann = await signUp("ann");
    await setUp(ann, { anchorDate: TODAY });
    expect((await allPeriods("ann")).length).toBe(1);

    const bob = await signUp("bob");
    await setUp(bob, { anchorDate: addDays(TODAY, -366) });
    expect((await current(bob)).period.seq).toBe(26);
  });

  it("starts monthly periods on the anchor day, clamped to short months", async () => {
    const client = await signUp("ann");
    await setUp(client, { type: "monthly", anchorDate: "2025-10-31" });
    await client.post("/api/periods/locate", { date: "2026-04-01" });

    expect((await allPeriods("ann")).map((p) => p.startDate)).toEqual([
      "2025-10-31",
      "2025-11-30",
      "2025-12-31",
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});

describe("time zone", () => {
  it("decides what today is from the budget's zone, not from UTC", async () => {
    t.clock.advance(15 * 60 * 60 * 1000); // 2026-01-16T03:00Z: still the 15th in Chicago, the 16th in Tokyo

    const chicago = await signUp("ann");
    const tooEarly = await chicago.post("/api/budget", { ...biweekly, anchorDate: "2026-01-16", timezone: "America/Chicago" });
    expect(tooEarly.status).toBe(400);
    await setUp(chicago, { anchorDate: "2026-01-15", timezone: "America/Chicago" });
    expect((await current(chicago)).period).toMatchObject({ startDate: "2026-01-15", isCurrent: true });

    const tokyo = await signUp("bob");
    await setUp(tokyo, { anchorDate: "2026-01-16", timezone: "Asia/Tokyo" });
    expect((await current(tokyo)).period).toMatchObject({ startDate: "2026-01-16", isCurrent: true });
  });

  it("rolls over to the next period at midnight in the budget's zone", async () => {
    const client = await signUp("ann");
    // Weekly from Jan 9 in Chicago: the first period ends Jan 15, Chicago time.
    await setUp(client, { type: "weekly", anchorDate: "2026-01-09", timezone: "America/Chicago" });
    expect((await current(client)).period.seq).toBe(0);

    t.clock.advance(17 * 60 * 60 * 1000); // 2026-01-16T05:00Z = 23:00 on the 15th in Chicago
    expect((await current(client)).period.seq).toBe(0);

    t.clock.advance(2 * 60 * 60 * 1000); // 01:00 on the 16th in Chicago
    expect((await current(client)).period).toMatchObject({ seq: 1, startDate: "2026-01-16" });
  });
});

describe("changing the time zone", () => {
  it("changes what today is without touching stored dates", async () => {
    const client = await signUp("ann");
    await setUp(client, { type: "weekly", anchorDate: "2026-01-09", timezone: "America/Chicago" });
    t.clock.advance(17 * 60 * 60 * 1000); // 2026-01-16T05:00Z: 23:00 on the 15th in Chicago, 14:00 on the 16th in Tokyo
    expect((await current(client)).period.seq).toBe(0);

    const response = await client.patch("/api/settings", { timezone: "Asia/Tokyo" });
    expect(response.status).toBe(200);
    expect((await response.json()).budget).toMatchObject({ timezone: "Asia/Tokyo", anchorDate: "2026-01-09", type: "weekly" });

    expect((await current(client)).period).toMatchObject({ seq: 1, startDate: "2026-01-16" });
    expect((await allPeriods("ann"))[0]).toMatchObject({ startDate: "2026-01-09", endDate: "2026-01-15" });
  });

  it("rejects an unknown zone, a missing budget and a missing session", async () => {
    const client = await signUp("ann");
    expect((await client.patch("/api/settings", { timezone: "UTC" })).status).toBe(409);

    await setUp(client);
    const bad = await client.patch("/api/settings", { timezone: "Mars/Olympus_Mons" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields).toHaveProperty("timezone");
    expect((await (await client.get("/api/budget")).json()).budget.timezone).toBe("UTC");

    expect((await t.client().patch("/api/settings", { timezone: "UTC" })).status).toBe(401);
  });
});

describe("current period", () => {
  it("creates the next period once today moves past the last one", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const before = await current(client);

    t.clock.advance(20 * DAY);
    const after = await current(client);

    expect(after.period).toMatchObject({ seq: 3, startDate: "2026-01-27", endDate: "2026-02-09", isCurrent: true });
    expect(after.nav.prevId).toBe(before.period.id);
    expect((await view(client, before.period.id)).period.isCurrent).toBe(false);
  });

  it("catches up over several missed periods at once", async () => {
    const client = await signUp("ann");
    await setUp(client);

    await advanceDays(client, 60);
    expect((await current(client)).period.seq).toBe(6);
    expect((await allPeriods("ann")).map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("creates no duplicates when several requests arrive together", async () => {
    const client = await signUp("ann");
    await setUp(client);
    t.clock.advance(20 * DAY);

    const views = await Promise.all([1, 2, 3, 4, 5].map(() => current(client)));

    expect(new Set(views.map((v) => v.period.id)).size).toBe(1);
    expect((await allPeriods("ann")).map((p) => p.seq)).toEqual([0, 1, 2, 3]);
  });

  it("asks for setup first", async () => {
    const client = await signUp("ann");
    for (const response of [
      await client.get("/api/periods/current"),
      await client.post("/api/periods/locate", { date: TODAY }),
      await client.get("/api/periods/anything"),
    ]) {
      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toBe("Set up your budget first");
    }
  });
});

describe("navigation", () => {
  it("links periods to their neighbours", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const [first, second, third] = await allPeriods("ann");

    expect((await view(client, first!.id)).nav).toEqual({ prevId: null, canAddPrevious: true, nextId: second!.id, nextDate: null });
    expect((await view(client, second!.id)).nav).toEqual({ prevId: first!.id, canAddPrevious: false, nextId: third!.id, nextDate: null });
    // The last generated period has no next yet, but offers the date that would create it.
    expect((await view(client, third!.id)).nav).toEqual({ prevId: second!.id, canAddPrevious: false, nextId: null, nextDate: "2026-01-27" });
  });

  it("locate returns an existing period without creating any", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const [first] = await allPeriods("ann");

    const response = await client.post("/api/periods/locate", { date: "2025-12-20" });
    expect(await response.json()).toEqual({ periodId: first!.id });
    expect((await allPeriods("ann")).length).toBe(3);
  });

  it("locate generates forward to a date within the horizon", async () => {
    const client = await signUp("ann");
    await setUp(client);

    const target = "2026-12-15"; // eleven months ahead
    const { periodId } = await (await client.post("/api/periods/locate", { date: target })).json();
    const located = await view(client, periodId);

    expect(located.period.startDate <= target && target <= located.period.endDate).toBe(true);
    expect(located.period.isCurrent).toBe(false);

    const periods = await allPeriods("ann");
    expect(periods.at(-1)!.id).toBe(periodId);
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i]!.seq).toBe(i);
      expect(periods[i]!.startDate).toBe(addDays(periods[i - 1]!.endDate, 1));
    }
  });

  it.each([
    ["more than a year ahead", "2027-03-15"],
    ["before the budget started", "2025-12-15"],
  ])("locate refuses a date %s", async (_label, date) => {
    const client = await signUp("ann");
    await setUp(client);

    const response = await client.post("/api/periods/locate", { date });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toHaveProperty("date");
    expect((await allPeriods("ann")).length).toBe(3);
  });

  it("stops offering a next period at the horizon", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const schedule = { type: biweekly.type, anchorDate: biweekly.anchorDate };
    const lastAllowed = nominalPeriod(schedule, horizonSeq(schedule, TODAY));

    const { periodId } = await (await client.post("/api/periods/locate", { date: lastAllowed.end })).json();
    const atHorizon = await view(client, periodId);
    expect(atHorizon.period.endDate).toBe(lastAllowed.end);
    expect(atHorizon.nav).toMatchObject({ nextId: null, nextDate: null });

    const beyond = await client.post("/api/periods/locate", { date: addDays(lastAllowed.end, 1) });
    expect(beyond.status).toBe(400);

    // A day later the horizon has moved on by at most one period; it never jumps.
    const beforeHorizon = await view(client, atHorizon.nav.prevId!);
    expect(beforeHorizon.nav.nextId).toBe(periodId);
  });

  it("extends the horizon as time passes", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const farDate = "2027-03-15";
    expect((await client.post("/api/periods/locate", { date: farDate })).status).toBe(400);

    await advanceDays(client, 90);
    expect((await client.post("/api/periods/locate", { date: farDate })).status).toBe(200);
  });
});

describe("listing periods", () => {
  const list = async (client: Client) => (await (await client.get("/api/periods")).json()) as PeriodListResponse;

  it("returns every existing period, oldest first, and creates none", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const before = await allPeriods("ann");

    const { periods } = await list(client);

    expect(periods).toEqual(before.map(({ id, startDate, endDate }) => ({ id, startDate, endDate })));
    expect(periods.length).toBeGreaterThan(1);
    expect(periods.map((period) => period.startDate)).toEqual(periods.map((period) => period.startDate).toSorted());
    expect(await allPeriods("ann")).toHaveLength(before.length);
  });

  it("includes a period generated later", async () => {
    const client = await signUp("ann");
    await setUp(client);
    const { periods: before } = await list(client);

    const target = addDays(before.at(-1)!.endDate, 1);
    const { periodId } = await (await client.post("/api/periods/locate", { date: target })).json();

    const { periods: after } = await list(client);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.id).toBe(periodId);
  });

  it("is a conflict before the budget is set up", async () => {
    const client = await signUp("ann");
    expect((await client.get("/api/periods")).status).toBe(409);
  });

  it("lists only the signed-in user's periods", async () => {
    const ann = await signUp("ann");
    await setUp(ann);
    const bob = await signUp("bob");
    await setUp(bob, { anchorDate: TODAY });

    const annIds = (await list(ann)).periods.map((period) => period.id);
    const bobIds = (await list(bob)).periods.map((period) => period.id);

    expect(bobIds).toHaveLength(1);
    expect(annIds.some((id) => bobIds.includes(id))).toBe(false);
  });
});

describe("access control", () => {
  it("requires a session", async () => {
    const anonymous = t.client();
    expect((await anonymous.get("/api/budget")).status).toBe(401);
    expect((await anonymous.post("/api/budget", biweekly)).status).toBe(401);
    expect((await anonymous.get("/api/periods/current")).status).toBe(401);
    expect((await anonymous.get("/api/periods")).status).toBe(401);
    expect((await anonymous.post("/api/periods/locate", { date: TODAY })).status).toBe(401);
  });

  it("hides one user's periods from another", async () => {
    const ann = await signUp("ann");
    await setUp(ann);
    const annPeriod = (await current(ann)).period.id;

    const bob = await signUp("bob");
    await setUp(bob, { openingCents: 1 });

    const response = await bob.get(`/api/periods/${annPeriod}`);
    expect(response.status).toBe(404);
    expect((await current(bob)).period.id).not.toBe(annPeriod);
    expect((await current(bob)).period.startingCents).toBe(1);
  });
});
