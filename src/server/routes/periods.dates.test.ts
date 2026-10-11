import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PeriodDatesResponse, PeriodView } from "../../shared/budget.ts";
import { addDays, dateOf } from "../../shared/dates.ts";
import { horizonSeq, nominalPeriod } from "../../shared/schedule.ts";
import type { PeriodRecord } from "../repos/types.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// Clock starts 2026-01-15T12:00Z, UTC budget, biweekly from 2025-12-16:
//   P0 12-16..12-29   P1 12-30..01-12   P2 01-13..01-26 (current)
//   P3 01-27..02-09   P4 02-10..02-23 (last generated)
const OPENING = 100_000;
const SCHEDULE = { type: "biweekly", anchorDate: "2025-12-16" } as const;

let t: TestApp;
let ann: Client;
let annId: string;
type Client = ReturnType<TestApp["client"]>;

async function signUp(name: string): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  await client.post("/api/budget", { ...SCHEDULE, openingCents: OPENING, timezone: "UTC" });
  await client.post("/api/periods/locate", { date: "2026-02-20" });
  return client;
}

beforeEach(async () => {
  t = await createTestApp();
  ann = await signUp("ann");
  annId = (await t.store.users.findByUsername("ann"))!.id;
});
afterEach(() => t.cleanup());

const periods = () => t.store.periods.listFromSeq(annId, 0);
const ranges = async () => (await periods()).map((p) => `${p.startDate.slice(5)}..${p.endDate.slice(5)}`);
const startings = async () => (await periods()).map((p) => p.startingCents);
const idOf = async (seq: number) => (await periods())[seq]!.id;
const viewOf = async (period: PeriodRecord) => (await (await ann.get(`/api/periods/${period.id}`)).json()) as PeriodView;
const namesIn = async (seq: number) => (await viewOf((await periods())[seq]!)).transactions.map((tx) => tx.name);

async function spend(name: string, date: string, amountCents: number) {
  const response = await ann.post("/api/transactions", { name, amountCents, kind: "expense", occursAt: `${date}T00:00` });
  expect(response.status).toBe(201);
}

async function changeDates(seq: number, body: Record<string, unknown>): Promise<PeriodDatesResponse> {
  const response = await ann.patch(`/api/periods/${await idOf(seq)}/dates`, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return response.json();
}

async function expectRejected(seq: number, body: Record<string, unknown>, field: string) {
  const before = [await ranges(), await startings()];
  for (const preview of [true, false]) {
    const response = await ann.patch(`/api/periods/${await idOf(seq)}/dates`, { ...body, preview });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields, `preview=${preview}`).toHaveProperty(field);
  }
  expect([await ranges(), await startings()]).toEqual(before);
}

/** Every automatic, unflagged starting amount equals the projected leftover of the period before it. */
async function expectChainConsistent() {
  const all = await periods();
  for (let i = 1; i < all.length; i++) {
    expect(all[i]!.startDate, `period ${i} follows period ${i - 1}`).toBe(addDays(all[i - 1]!.endDate, 1));
    if (all[i]!.startingMode === "manual" || all[i]!.carryStale) continue;
    const previous = all[i - 1]!;
    const sums = await t.store.transactions.sumInRange(annId, previous.startDate, previous.endDate);
    expect(all[i]!.startingCents, `starting amount of period ${i}`).toBe(
      previous.startingCents + sums.paidCents + sums.upcomingCents,
    );
  }
}

describe("moving a period's start", () => {
  it("moves the previous period's end with it and takes over the transactions on those days", async () => {
    await spend("last day of P1", "2026-01-12", 2000);
    await spend("earlier in P1", "2026-01-05", 300);
    expect(await startings()).toEqual([OPENING, OPENING, OPENING - 2300, OPENING - 2300, OPENING - 2300]);

    const result = await changeDates(2, { startDate: "2026-01-12" });

    expect(await ranges()).toEqual(["12-16..12-29", "12-30..01-11", "01-12..01-26", "01-27..02-09", "02-10..02-23"]);
    expect(result.changes).toEqual([
      { role: "previous", startDate: "2025-12-30", endDate: "2026-01-11", previousStartDate: "2025-12-30", previousEndDate: "2026-01-12" },
      { role: "this", startDate: "2026-01-12", endDate: "2026-01-26", previousStartDate: "2026-01-13", previousEndDate: "2026-01-26" },
    ]);
    expect(result.movedTransactions).toBe(1);
    expect(result.view.period).toMatchObject({ startDate: "2026-01-12", datesEdited: true, nominalStart: "2026-01-13" });
    expect(result.view.transactions.map((tx) => tx.name)).toEqual(["last day of P1"]);
    expect(await namesIn(1)).toEqual(["earlier in P1"]);

    // P2 now starts with more (P1 lost an expense) but projects the same, so P3 on is unchanged.
    expect(await startings()).toEqual([OPENING, OPENING, OPENING - 300, OPENING - 2300, OPENING - 2300]);
    await expectChainConsistent();
  });

  it("hands days back to the previous period when moved later", async () => {
    await spend("first day of P2", "2026-01-13", 1500);
    const result = await changeDates(2, { startDate: "2026-01-14" });

    expect(await ranges()).toEqual(["12-16..12-29", "12-30..01-13", "01-14..01-26", "01-27..02-09", "02-10..02-23"]);
    expect(result.movedTransactions).toBe(1);
    expect(await namesIn(1)).toEqual(["first day of P2"]);
    await expectChainConsistent();
  });
});

describe("moving a period's end", () => {
  it("moves only the shared boundary with the next period", async () => {
    await changeDates(2, { endDate: "2026-01-27" });

    expect(await ranges()).toEqual(["12-16..12-29", "12-30..01-12", "01-13..01-27", "01-28..02-09", "02-10..02-23"]);
    const all = await periods();
    expect(all[3]).toMatchObject({ nominalStart: "2026-01-27", nominalEnd: "2026-02-09" });
    expect(all[4]).toMatchObject({ startDate: "2026-02-10", endDate: "2026-02-23" });
  });

  it("handles a payday that lands a day early", async () => {
    await spend("bill on the old last day", "2026-01-26", 4000);
    await spend("mid-period", "2026-01-20", 1000);

    const result = await changeDates(2, { endDate: "2026-01-25" });

    expect(await ranges()).toEqual(["12-16..12-29", "12-30..01-12", "01-13..01-25", "01-26..02-09", "02-10..02-23"]);
    expect(result.changes.map((change) => change.role)).toEqual(["this", "next"]);
    expect(result.movedTransactions).toBe(1);
    expect(await namesIn(2)).toEqual(["mid-period"]);
    expect(await namesIn(3)).toEqual(["bill on the old last day"]);
    // P3 starts 4000 better off and carries the bill itself; P4 sees no difference.
    expect(await startings()).toEqual([OPENING, OPENING, OPENING, OPENING - 1000, OPENING - 5000]);
    await expectChainConsistent();
  });

  it("can move both ends at once", async () => {
    await spend("a", "2026-01-12", 100);
    await spend("b", "2026-01-26", 200);

    const result = await changeDates(2, { startDate: "2026-01-12", endDate: "2026-01-25" });

    expect(result.changes.map((change) => change.role)).toEqual(["previous", "this", "next"]);
    expect(result.movedTransactions).toBe(2);
    expect(await namesIn(1)).toEqual([]);
    expect(await namesIn(2)).toEqual(["a"]);
    expect(await namesIn(3)).toEqual(["b"]);
    await expectChainConsistent();
  });
});

describe("the last generated period", () => {
  it("generates the next period so days it gives up have somewhere to go", async () => {
    await spend("on the last day", "2026-02-23", 900);

    const result = await changeDates(4, { endDate: "2026-02-22" });

    expect((await ranges()).slice(4)).toEqual(["02-10..02-22", "02-23..03-09"]);
    expect(result.changes.map((change) => change.role)).toEqual(["this", "next"]);
    expect(await namesIn(5)).toEqual(["on the last day"]);
    await expectChainConsistent();
  });

  it("generates the next period when its end moves later, too", async () => {
    await changeDates(4, { endDate: "2026-02-24" });
    expect((await ranges()).slice(4)).toEqual(["02-10..02-24", "02-25..03-09"]);
  });

  it("is followed, when generated later, by a period that starts after its end and ends on schedule", async () => {
    // Set directly, as if edited while no next period could be generated.
    await t.store.periods.update(annId, await idOf(4), { endDate: "2026-02-25" }, t.clock.now());
    await ann.post("/api/periods/locate", { date: "2026-03-01" });

    expect((await periods())[5]).toMatchObject({
      startDate: "2026-02-26",
      endDate: "2026-03-09",
      nominalStart: "2026-02-24",
      nominalEnd: "2026-03-09",
    });
  });

  describe("at the horizon", () => {
    let lastSeq: number;
    let last: { start: string; end: string };

    beforeEach(async () => {
      lastSeq = horizonSeq(SCHEDULE, "2026-01-15");
      last = nominalPeriod(SCHEDULE, lastSeq);
      await ann.post("/api/periods/locate", { date: last.end });
      expect((await periods()).length).toBe(lastSeq + 1);
    });

    it("may end later, but must leave room for the period that will follow", async () => {
      const limit = addDays(nominalPeriod(SCHEDULE, lastSeq + 1).end, -1);
      await expectRejected(lastSeq, { endDate: addDays(limit, 1) }, "endDate");

      const result = await changeDates(lastSeq, { endDate: addDays(last.end, 1) });
      expect(result.changes.map((change) => change.role)).toEqual(["this"]);
      expect((await periods()).length).toBe(lastSeq + 1);
    });

    it("may end earlier only if no transactions would be left without a period", async () => {
      await spend("on the last day", last.end, 500);
      await expectRejected(lastSeq, { endDate: addDays(last.end, -1) }, "endDate");

      await expectRejected(lastSeq, { endDate: addDays(last.end, -3) }, "endDate");
      const view = await viewOf((await periods())[lastSeq]!);
      await ann.delete(`/api/transactions/${view.transactions[0]!.id}`);
      await changeDates(lastSeq, { endDate: addDays(last.end, -1) });
      expect((await periods())[lastSeq]!.endDate).toBe(addDays(last.end, -1));
    });
  });
});

describe("the first period", () => {
  it("may start earlier", async () => {
    const result = await changeDates(0, { startDate: "2025-12-10" });
    expect(result.changes.map((change) => change.role)).toEqual(["this"]);
    expect((await ranges())[0]).toBe("12-10..12-29");

    // The budget now reaches back that far.
    expect((await ann.post("/api/periods/locate", { date: "2025-12-10" })).status).toBe(200);
    expect((await ann.post("/api/periods/locate", { date: "2025-12-09" })).status).toBe(400);
  });

  it("may start later only if that leaves no transaction without a period", async () => {
    await spend("early", "2025-12-17", 100);
    await expectRejected(0, { startDate: "2025-12-18" }, "startDate");

    await changeDates(0, { startDate: "2025-12-17" });
    expect((await ranges())[0]).toBe("12-17..12-29");
    expect(await namesIn(0)).toEqual(["early"]);
  });
});

describe("limits", () => {
  it.each([
    ["a start that would leave the previous period no days", { startDate: "2025-12-30" }, "startDate"],
    ["an end that would leave the next period no days", { endDate: "2026-02-09" }, "endDate"],
    ["a start after the end", { startDate: "2026-01-27" }, "startDate"],
    ["an end before the start", { endDate: "2026-01-12" }, "endDate"],
    ["dates that share no day with the current ones", { startDate: "2026-01-28", endDate: "2026-02-05" }, "startDate"],
    ["an impossible date", { startDate: "2026-02-30" }, "startDate"],
  ])("rejects %s", async (_label, body, field) => {
    await expectRejected(2, body, field);
  });

  it("allows shrinking a neighbour to a single day", async () => {
    await changeDates(2, { startDate: "2025-12-31", endDate: "2026-02-08" });
    expect(await ranges()).toEqual(["12-16..12-29", "12-30..12-30", "12-31..02-08", "02-09..02-09", "02-10..02-23"]);
  });

  it("rejects a request that changes neither date", async () => {
    expect((await ann.patch(`/api/periods/${await idOf(2)}/dates`, {})).status).toBe(400);
    expect((await ann.patch(`/api/periods/${await idOf(2)}/dates`, { preview: true })).status).toBe(400);
  });

  it("treats the current dates as no change", async () => {
    const result = await changeDates(2, { startDate: "2026-01-13", endDate: "2026-01-26" });
    expect(result).toMatchObject({ changes: [], movedTransactions: 0 });
  });
});

describe("preview", () => {
  it("reports exactly what the real change then does, and writes nothing", async () => {
    await spend("a", "2026-01-12", 100);
    await spend("b", "2026-01-26", 200);
    const body = { startDate: "2026-01-12", endDate: "2026-01-25" };
    const before = [await ranges(), await startings()];

    const preview = await changeDates(2, { ...body, preview: true });
    expect(preview.view.period).toMatchObject({ startDate: "2026-01-13", endDate: "2026-01-26", datesEdited: false });
    expect([await ranges(), await startings()]).toEqual(before);

    const real = await changeDates(2, body);
    expect(real.changes).toEqual(preview.changes);
    expect(real.movedTransactions).toBe(preview.movedTransactions);
  });

  it("describes the next period even before it exists, without generating it", async () => {
    await spend("on the last day", "2026-02-23", 900);

    const preview = await changeDates(4, { endDate: "2026-02-22", preview: true });
    expect(preview.changes).toEqual([
      { role: "this", startDate: "2026-02-10", endDate: "2026-02-22", previousStartDate: "2026-02-10", previousEndDate: "2026-02-23" },
      { role: "next", startDate: "2026-02-23", endDate: "2026-03-09", previousStartDate: "2026-02-24", previousEndDate: "2026-03-09" },
    ]);
    expect(preview.movedTransactions).toBe(1);
    expect((await periods()).length).toBe(5);

    const real = await changeDates(4, { endDate: "2026-02-22" });
    expect(real.changes).toEqual(preview.changes);
  });
});

describe("reverting dates", () => {
  it("puts the period and both shared boundaries back on schedule", async () => {
    await spend("a", "2026-01-12", 100);
    await changeDates(2, { startDate: "2026-01-12", endDate: "2026-01-28" });
    expect((await viewOf((await periods())[3]!)).period.datesEdited).toBe(true);

    const response = await ann.post(`/api/periods/${await idOf(2)}/dates/revert`);
    expect(response.status).toBe(200);
    const result = (await response.json()) as PeriodDatesResponse;

    expect(result.view.period.datesEdited).toBe(false);
    expect(await ranges()).toEqual(["12-16..12-29", "12-30..01-12", "01-13..01-26", "01-27..02-09", "02-10..02-23"]);
    expect(await namesIn(1)).toEqual(["a"]);
    await expectChainConsistent();
  });
});

describe("what a date change leaves alone", () => {
  it("neither duplicates nor drops recurring transactions", async () => {
    const created = await ann.post("/api/recurring", {
      name: "Groceries",
      kind: "expense",
      defaultAmountCents: 1000,
      recurrenceUnit: "week",
      firstDueDate: "2025-12-22", // Mondays
    });
    const recurringId = (await created.json()).item.id as string;
    const occurrences = async () => {
      const dates: string[] = [];
      for (const period of await periods()) {
        const view = await viewOf(period);
        dates.push(...view.transactions.filter((tx) => tx.recurringId === recurringId).map((tx) => dateOf(tx.occursAt)));
      }
      return dates;
    };
    const before = await occurrences();
    expect(before.length).toBe(10);

    await changeDates(2, { startDate: "2026-01-12", endDate: "2026-01-25" }); // both boundaries are Mondays' neighbours
    await changeDates(3, { endDate: "2026-02-10" });
    await changeDates(4, { endDate: "2026-02-22" }); // generates P5
    await ann.post(`/api/periods/${await idOf(2)}/dates/revert`);

    const after = await occurrences();
    expect(after.filter((date) => date <= "2026-02-23")).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
    await expectChainConsistent();
  });

  it("keeps hand-set and flagged starting amounts as they were", async () => {
    const [, p1, , p3] = await periods();
    await spend("moves", "2026-01-12", 2000);
    await ann.patch(`/api/periods/${p3!.id}/starting`, { startingCents: 5000, carryForward: true });
    await ann.patch(`/api/periods/${p1!.id}/starting`, { startingCents: 90_000, carryForward: false });
    const flags = async () => (await periods()).map((p) => `${p.startingMode[0]}${p.carryStale ? "S" : "-"}`).join(" ");
    expect(await flags()).toBe("a- m- aS m- a-");
    expect(await startings()).toEqual([OPENING, 90_000, OPENING - 2000, 5000, 5000]);

    await changeDates(2, { startDate: "2026-01-12" });

    expect(await flags()).toBe("a- m- aS m- a-");
    // P2 follows P1's change (it lost a 2000 expense); P3 is pinned; P4 is unaffected.
    expect(await startings()).toEqual([OPENING, 90_000, OPENING, 5000, 5000]);
  });
});

describe("access control", () => {
  it("requires a session and hides other users' periods", async () => {
    const id = await idOf(2);
    const anonymous = t.client();
    expect((await anonymous.patch(`/api/periods/${id}/dates`, { endDate: "2026-01-25" })).status).toBe(401);
    expect((await anonymous.post(`/api/periods/${id}/dates/revert`)).status).toBe(401);

    const bob = await signUp("bob");
    expect((await bob.patch(`/api/periods/${id}/dates`, { endDate: "2026-01-25" })).status).toBe(404);
    expect((await bob.post(`/api/periods/${id}/dates/revert`)).status).toBe(404);
    expect((await ranges())[2]).toBe("01-13..01-26");
  });
});
