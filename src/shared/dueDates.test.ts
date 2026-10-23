import { describe, expect, it } from "vitest";
import {
  describeDue,
  type DueCheck,
  dueChecksBetween,
  type DueNotice,
  dueDatesAround,
  dueNoticeMessage,
  type DuePayment,
  type DueRule,
  nextDueOn,
  uncoveredDue,
} from "./dueDates.ts";

const rule = (overrides: Partial<DueRule> = {}): DueRule => ({
  unit: "month",
  interval: 1,
  date: "2026-01-20",
  endDate: null,
  ...overrides,
});

describe("dueChecksBetween", () => {
  it.each<[string, DueRule, string, string, DueCheck[]]>([
    [
      "the 20th of each month, in a biweekly period that holds it",
      rule(),
      "2026-02-10",
      "2026-02-23",
      [{ dueDate: "2026-02-20", previous: "2026-01-20", next: "2026-03-20" }],
    ],
    ["nothing in a period without one", rule(), "2026-01-27", "2026-02-09", []],
    [
      "the first one still has a cycle before it",
      rule(),
      "2026-01-13",
      "2026-01-26",
      [{ dueDate: "2026-01-20", previous: "2025-12-20", next: "2026-02-20" }],
    ],
    ["nothing before the first", rule(), "2025-12-16", "2025-12-29", []],
    [
      "the 31st falls back to the last day of short months on either side",
      rule({ date: "2026-01-31" }),
      "2026-03-01",
      "2026-03-31",
      [{ dueDate: "2026-03-31", previous: "2026-02-28", next: "2026-04-30" }],
    ],
    [
      "weekly, two in a fortnight",
      rule({ unit: "week", date: "2026-01-02" }),
      "2026-01-13",
      "2026-01-26",
      [
        { dueDate: "2026-01-16", previous: "2026-01-09", next: "2026-01-23" },
        { dueDate: "2026-01-23", previous: "2026-01-16", next: "2026-01-30" },
      ],
    ],
    [
      "every three months",
      rule({ interval: 3, date: "2026-01-15" }),
      "2026-04-10",
      "2026-04-23",
      [{ dueDate: "2026-04-15", previous: "2026-01-15", next: "2026-07-15" }],
    ],
    [
      "yearly",
      rule({ unit: "year", date: "2025-04-15" }),
      "2026-04-10",
      "2026-04-23",
      [{ dueDate: "2026-04-15", previous: "2025-04-15", next: "2027-04-15" }],
    ],
    ["nothing after the item ends", rule({ endDate: "2026-02-19" }), "2026-02-10", "2026-02-23", []],
  ])("%s", (_, dueRule, from, to, expected) => {
    expect(dueChecksBetween(dueRule, from, to)).toEqual(expected);
  });
});

describe("uncoveredDue", () => {
  const check: DueCheck = { dueDate: "2026-02-20", previous: "2026-01-20", next: "2026-03-20" };

  // A date ending in "!" is a payment marked late.
  const payment = (text: string): DuePayment => ({ date: text.replace("!", ""), late: text.endsWith("!") });

  it.each<[string, string[], ReturnType<typeof uncoveredDue>]>([
    ["covered by a payment in the cycle", ["2026-02-13"], null],
    ["covered by one on the day it is due", ["2026-02-20"], null],
    ["covered by one the day after the due date before", ["2026-01-21"], null],
    ["covered when one of several is in the cycle", ["2026-01-10", "2026-02-01", "2026-02-25"], null],
    ["not covered by one on the due date before: that paid the last one", ["2026-01-20"], { dueDate: "2026-02-20", lateDate: null }],
    ["nothing at all", [], { dueDate: "2026-02-20", lateDate: null }],
    ["late: the first payment after it is due", ["2026-03-06", "2026-02-27"], { dueDate: "2026-02-20", lateDate: "2026-02-27" }],
    ["one on the next due date is that one's, not a late one", ["2026-03-20"], { dueDate: "2026-02-20", lateDate: null }],
    // A payment marked late paid the due date before it, so it covers nothing in its own cycle.
    ["not covered by one marked late for the due date before", ["2026-01-30!"], { dueDate: "2026-02-20", lateDate: null }],
    ["covered by an ordinary one beside one marked late", ["2026-01-30!", "2026-02-13"], null],
    ["one marked late after it is due is still named as late", ["2026-02-27!"], { dueDate: "2026-02-20", lateDate: "2026-02-27" }],
  ])("%s", (_, payments, expected) => {
    expect(uncoveredDue(check, payments.map(payment))).toEqual(expected);
  });
});

describe("dueDatesAround", () => {
  it.each<[string, DueRule, string, ReturnType<typeof dueDatesAround>]>([
    ["between two", rule(), "2026-02-13", { before: "2026-01-20", next: "2026-02-20" }],
    ["on a due date, that one is next", rule(), "2026-02-20", { before: "2026-01-20", next: "2026-02-20" }],
    ["the day after one, that one is before", rule(), "2026-02-21", { before: "2026-02-20", next: "2026-03-20" }],
    ["nothing before the first", rule(), "2026-01-10", { before: null, next: "2026-01-20" }],
    ["nothing next once it has ended", rule({ endDate: "2026-02-28" }), "2026-03-05", { before: "2026-02-20", next: null }],
  ])("%s", (_, dueRule, date, expected) => {
    expect(dueDatesAround(dueRule, date)).toEqual(expected);
  });
});

describe("dueNoticeMessage", () => {
  const notice = (lateDate: string | null): DueNotice => ({
    billIncomeId: "card",
    name: "Visa",
    dueDate: "2026-02-20",
    lateDate,
  });

  it.each<[string, string | null, string, string]>([
    ["nothing set, still to come", null, "2026-02-15", "Visa is due Feb 20, and nothing is set to pay it by then."],
    ["nothing set, on the day", null, "2026-02-20", "Visa is due Feb 20, and nothing is set to pay it by then."],
    ["nothing set, passed", null, "2026-02-21", "Visa was due Feb 20, and nothing was set to pay it by then."],
    ["late, still to come", "2026-02-27", "2026-02-15", "Visa is due Feb 20, but its payment is set for Feb 27."],
    ["late, passed", "2026-02-27", "2026-03-01", "Visa was due Feb 20, but its payment was dated Feb 27."],
  ])("%s", (_, lateDate, today, expected) => {
    expect(dueNoticeMessage(notice(lateDate), today)).toBe(expected);
  });
});

describe("describeDue and nextDueOn", () => {
  it.each<[DueRule, string]>([
    [rule(), "Due every month on the 20th"],
    [rule({ unit: "week", interval: 2, date: "2026-01-02" }), "Due every 2 weeks on Friday"],
    [rule({ unit: "year", date: "2026-04-15" }), "Due every year on Apr 15"],
  ])("describes %j", (dueRule, expected) => {
    expect(describeDue(dueRule)).toBe(expected);
  });

  it("finds the next day it is due, and none once the item has ended", () => {
    expect(nextDueOn(rule(), "2026-01-15")).toBe("2026-01-20");
    expect(nextDueOn(rule(), "2026-01-21")).toBe("2026-02-20");
    expect(nextDueOn(rule(), "2026-01-20")).toBe("2026-01-20");
    expect(nextDueOn(rule({ endDate: "2026-02-01" }), "2026-01-21")).toBeNull();
  });
});
