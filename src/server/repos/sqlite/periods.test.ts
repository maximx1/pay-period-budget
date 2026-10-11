import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../../testing.ts";
import { type PeriodRecord, UniqueConstraintError } from "../types.ts";

const now = new Date("2026-01-15T12:00:00Z");

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  for (const id of ["ann", "bob"]) {
    await t.store.users.create({ id, username: id, email: `${id}@example.com`, passwordHash: "x", now });
    await t.store.schedules.create({
      id: `schedule-${id}`,
      userId: id,
      type: "biweekly",
      anchorDate: "2026-01-02",
      openingCents: 0,
      createdAt: now,
    });
  }
});
afterEach(() => t.cleanup());

const period = (userId: string, seq: number, startDate: string, endDate: string): PeriodRecord => ({
  id: `${userId}-p${seq}`,
  userId,
  scheduleId: `schedule-${userId}`,
  seq,
  startDate,
  endDate,
  nominalStart: startDate,
  nominalEnd: endDate,
  startingCents: 0,
  startingMode: "auto",
  carryStale: false,
  createdAt: now,
  updatedAt: now,
});

describe("period repo", () => {
  beforeEach(async () => {
    await t.store.periods.create(period("ann", 0, "2026-01-02", "2026-01-15"));
    await t.store.periods.create(period("ann", 1, "2026-01-16", "2026-01-29"));
  });

  it.each([
    ["2026-01-02", "ann-p0"],
    ["2026-01-15", "ann-p0"],
    ["2026-01-16", "ann-p1"],
    ["2026-01-29", "ann-p1"],
  ])("finds the period containing %s", async (date, id) => {
    expect((await t.store.periods.findContaining("ann", date))?.id).toBe(id);
  });

  it("finds nothing outside the generated range", async () => {
    expect(await t.store.periods.findContaining("ann", "2026-01-01")).toBeNull();
    expect(await t.store.periods.findContaining("ann", "2026-01-30")).toBeNull();
  });

  it("returns the last period and lists from a seq in order", async () => {
    expect((await t.store.periods.findLast("ann"))?.id).toBe("ann-p1");
    expect((await t.store.periods.listFromSeq("ann", 0)).map((p) => p.seq)).toEqual([0, 1]);
    expect((await t.store.periods.listFromSeq("ann", 1)).map((p) => p.seq)).toEqual([1]);
    expect(await t.store.periods.findLast("bob")).toBeNull();
  });

  it("reports a duplicate seq or start date as a unique violation", async () => {
    await expect(t.store.periods.create({ ...period("ann", 1, "2026-01-30", "2026-02-12"), id: "dup-seq" })).rejects.toEqual(
      new UniqueConstraintError("seq", ["userId", "seq"]),
    );
    await expect(t.store.periods.create({ ...period("ann", 2, "2026-01-16", "2026-02-12"), id: "dup-start" })).rejects.toEqual(
      new UniqueConstraintError("startDate", ["userId", "startDate"]),
    );
  });

  it("updates only the given fields and stamps updatedAt", async () => {
    const later = new Date("2026-01-20T00:00:00Z");
    await t.store.periods.update("ann", "ann-p1", { startingCents: 5000, startingMode: "manual" }, later);
    expect(await t.store.periods.findById("ann", "ann-p1")).toMatchObject({
      startingCents: 5000,
      startingMode: "manual",
      carryStale: false,
      endDate: "2026-01-29",
      updatedAt: later,
    });
  });

  it("keeps one user's periods out of another's reach", async () => {
    expect(await t.store.periods.findById("bob", "ann-p0")).toBeNull();
    expect(await t.store.periods.findBySeq("bob", 0)).toBeNull();
    expect(await t.store.periods.findContaining("bob", "2026-01-10")).toBeNull();

    await t.store.periods.update("bob", "ann-p0", { startingCents: 999 }, now);
    expect((await t.store.periods.findById("ann", "ann-p0"))?.startingCents).toBe(0);
  });
});

describe("settings repo", () => {
  it("inserts, then updates in place", async () => {
    expect(await t.store.settings.get("ann")).toBeNull();
    await t.store.settings.upsert("ann", { timezone: "America/Chicago" }, now);
    await t.store.settings.upsert("ann", { timezone: "Asia/Tokyo" }, new Date("2026-02-01T00:00:00Z"));

    expect(await t.store.settings.get("ann")).toMatchObject({ timezone: "Asia/Tokyo", createdAt: now });
    expect(await t.store.settings.get("bob")).toBeNull();
  });
});
