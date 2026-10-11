import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodView } from "../../shared/budget.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// Clock starts 2026-01-15T12:00Z, UTC budget, biweekly from 2025-12-16:
//   P0 12-16..12-29   P1 12-30..01-12   P2 01-13..01-26 (current)
//   P3 01-27..02-09   P4 02-10..02-23   P5 02-24..03-09
// One expense per period (1000, 2000, ... 6000 cents), so the starting amounts run
//   100000, 99000, 97000, 94000, 90000, 85000.
const OPENING = 100_000;
const DATES = ["2025-12-20", "2026-01-05", "2026-01-20", "2026-02-01", "2026-02-15", "2026-03-01"];
const BASE = [100_000, 99_000, 97_000, 94_000, 90_000, 85_000];

let t: TestApp;
let ann: Client;
let annId: string;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: OPENING, timezone: "UTC" });
  await client.post("/api/periods/locate", { date: "2026-03-05" });
  return client;
}

const spend = async (client: Client, date: string, amountCents: number) =>
  expect((await client.post("/api/transactions", { name: "x", amountCents, kind: "expense", occursAt: `${date}T00:00` })).status).toBe(201);

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  annId = (await t.store.users.findByUsername("ann"))!.id;
  for (const [index, date] of DATES.entries()) await spend(ann, date, (index + 1) * 1000);
  expect(await startings()).toEqual(BASE);
});
afterEach(() => t.cleanup());

const periods = () => t.store.periods.listFromSeq(annId, 0);
const startings = async () => (await periods()).map((p) => p.startingCents);
const modes = async () => (await periods()).map((p) => (p.startingMode === "manual" ? "M" : "a")).join("");
const stale = async () => (await periods()).map((p) => (p.carryStale ? "S" : "-")).join("");
const idOf = async (seq: number) => (await periods())[seq]!.id;

async function setStarting(seq: number, startingCents: number, carryForward: boolean): Promise<PeriodView> {
  const response = await ann.patch(`/api/periods/${await idOf(seq)}/starting`, { startingCents, carryForward });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}
const revert = async (seq: number) => ann.post(`/api/periods/${await idOf(seq)}/starting/revert`);
const recalculate = async (seq: number) => ann.post(`/api/periods/${await idOf(seq)}/recalculate`);

describe("setting a starting amount by hand", () => {
  it("carries the difference into every later period when asked", async () => {
    const view = await setStarting(2, 50_000, true);

    expect(view.period).toMatchObject({ startingCents: 50_000, startingMode: "manual", carryStale: false });
    expect(view.totals.projectedCents).toBe(47_000);
    expect(await startings()).toEqual([100_000, 99_000, 50_000, 47_000, 43_000, 38_000]);
    expect(await modes()).toBe("aaMaaa");
    expect(await stale()).toBe("------");
  });

  it("leaves later periods alone but flags them when not carried", async () => {
    await setStarting(2, 50_000, false);

    expect(await startings()).toEqual([100_000, 99_000, 50_000, 94_000, 90_000, 85_000]);
    expect(await modes()).toBe("aaMaaa");
    expect(await stale()).toBe("---SSS");
  });

  it("does not flag anything when the amount typed is the one already there", async () => {
    await setStarting(2, 97_000, false);
    expect(await modes()).toBe("aaMaaa");
    expect(await stale()).toBe("------");
    expect(await startings()).toEqual(BASE);
  });

  it("accepts a negative amount and rejects a fractional or missing one", async () => {
    expect((await setStarting(2, -2500, true)).period.startingCents).toBe(-2500);

    const id = await idOf(2);
    for (const body of [{ startingCents: 10.5, carryForward: true }, { startingCents: 100 }, { carryForward: true }, {}]) {
      expect((await ann.patch(`/api/periods/${id}/starting`, body)).status).toBe(400);
    }
  });
});

describe("a pinned amount and the periods after it", () => {
  beforeEach(async () => {
    await setStarting(2, 50_000, false);
  });

  it("is untouched by changes before it, which also stop there", async () => {
    await spend(ann, "2026-01-06", 500); // in P1

    expect(await startings()).toEqual([100_000, 99_000, 50_000, 94_000, 90_000, 85_000]);
  });

  it("lets flagged periods keep following new transactions", async () => {
    await spend(ann, "2026-02-02", 700); // in P3

    expect(await startings()).toEqual([100_000, 99_000, 50_000, 94_000, 89_300, 84_300]);
    expect(await stale()).toBe("---SSS");
  });

  it("recalculates the whole flagged run from any period in it", async () => {
    await spend(ann, "2026-02-02", 700);

    const response = await recalculate(4);
    expect(response.status).toBe(200);
    expect(((await response.json()) as PeriodView).period).toMatchObject({ startingCents: 42_300, carryStale: false });

    // 50000 - 3000 = 47000; - 4000 - 700 = 42300; - 5000 = 37300
    expect(await startings()).toEqual([100_000, 99_000, 50_000, 47_000, 42_300, 37_300]);
    expect(await stale()).toBe("------");
    expect(await modes()).toBe("aaMaaa");
  });

  it("marks a period generated after a flagged one as flagged too", async () => {
    await ann.post("/api/periods/locate", { date: "2026-03-12" });
    expect(await stale()).toBe("---SSSS");

    await recalculate(3);
    await ann.post("/api/periods/locate", { date: "2026-03-26" });
    expect(await stale()).toBe("--------");
  });

  it("shifts flagged periods on a further carried edit, leaving the flags", async () => {
    await setStarting(2, 51_000, true);

    expect(await startings()).toEqual([100_000, 99_000, 51_000, 95_000, 91_000, 86_000]);
    expect(await stale()).toBe("---SSS");
  });
});

describe("two pinned periods", () => {
  beforeEach(async () => {
    await setStarting(4, 70_000, true);
    expect(await startings()).toEqual([100_000, 99_000, 97_000, 94_000, 70_000, 65_000]);
  });

  it("carries an edit to the first only as far as the second", async () => {
    await setStarting(1, 80_000, true);

    expect(await startings()).toEqual([100_000, 80_000, 78_000, 75_000, 70_000, 65_000]);
    expect(await modes()).toBe("aMaaMa");
    expect(await stale()).toBe("------");
  });

  it("flags only the periods between them when not carried", async () => {
    await setStarting(1, 60_000, false);

    expect(await startings()).toEqual([100_000, 60_000, 97_000, 94_000, 70_000, 65_000]);
    expect(await stale()).toBe("--SS--");
  });

  it("recalculating between them stops at the second", async () => {
    await setStarting(1, 60_000, false);
    await recalculate(3);

    expect(await startings()).toEqual([100_000, 60_000, 58_000, 55_000, 70_000, 65_000]);
    expect(await stale()).toBe("------");
    expect(await modes()).toBe("aMaaMa");
  });
});

describe("reverting to the calculated amount", () => {
  it("takes the previous period's projected leftover and brings later periods along", async () => {
    await setStarting(4, 70_000, true);

    const response = await revert(4);
    expect(response.status).toBe(200);
    expect(((await response.json()) as PeriodView).period).toMatchObject({ startingCents: 90_000, startingMode: "auto" });
    expect(await startings()).toEqual(BASE);
    expect(await modes()).toBe("aaaaaa");
  });

  it("clears the flags an uncarried edit left behind", async () => {
    await setStarting(2, 50_000, false);
    await revert(2);

    expect(await startings()).toEqual(BASE);
    expect(await stale()).toBe("------");
  });

  it("returns the first period to the opening balance", async () => {
    await setStarting(0, 5_000, true);
    expect(await startings()).toEqual([5_000, 4_000, 2_000, -1_000, -5_000, -10_000]);

    await revert(0);
    expect(await startings()).toEqual(BASE);
  });

  it("stops at the next pinned period", async () => {
    await setStarting(1, 80_000, true);
    await setStarting(3, 10_000, true);
    await revert(1);

    expect(await startings()).toEqual([100_000, 99_000, 97_000, 10_000, 6_000, 1_000]);
    expect(await modes()).toBe("aaaMaa");
  });

  it("stays flagged when the period it is calculated from is itself out of date", async () => {
    await setStarting(1, 60_000, false); // P2..P5 flagged
    await setStarting(3, 1, true); // pinned, so no longer flagged
    expect(await stale()).toBe("--S-SS");

    await revert(3);
    // Calculated from P2, which is still out of date, so the result is too.
    expect((await periods())[3]).toMatchObject({ startingCents: 94_000, startingMode: "auto", carryStale: true });
    expect(await stale()).toBe("--SSSS");

    await recalculate(5);
    expect(await startings()).toEqual([100_000, 60_000, 58_000, 55_000, 51_000, 46_000]);
    expect(await stale()).toBe("------");
  });
});

describe("refusals", () => {
  it("won't revert an amount that is already calculated or recalculate one that isn't flagged", async () => {
    expect((await revert(2)).status).toBe(409);
    expect((await recalculate(2)).status).toBe(409);
    expect(await startings()).toEqual(BASE);
  });

  it("requires a session and hides other users' periods", async () => {
    const id = await idOf(2);
    const anonymous = t.client();
    expect((await anonymous.patch(`/api/periods/${id}/starting`, { startingCents: 1, carryForward: true })).status).toBe(401);
    expect((await anonymous.post(`/api/periods/${id}/starting/revert`)).status).toBe(401);
    expect((await anonymous.post(`/api/periods/${id}/recalculate`)).status).toBe(401);

    const bob = await signUp("bob");
    expect((await bob.patch(`/api/periods/${id}/starting`, { startingCents: 1, carryForward: true })).status).toBe(404);
    expect((await bob.post(`/api/periods/${id}/starting/revert`)).status).toBe(404);
    expect((await bob.post(`/api/periods/${id}/recalculate`)).status).toBe(404);
    expect(await startings()).toEqual(BASE);
  });
});
