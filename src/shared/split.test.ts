import { describe, expect, it } from "vitest";
import { laterTotal, planShares, splitEvenly, splitNote, transactionSplitSchema, waitingStatus } from "./split.ts";

describe("splitEvenly", () => {
  it.each([
    // $432.67 over ten periods: seven of $43.27, then three of $43.26.
    [43267, 10, [4327, 4327, 4327, 4327, 4327, 4327, 4327, 4326, 4326, 4326]],
    [1000, 4, [250, 250, 250, 250]],
    [1001, 4, [251, 250, 250, 250]],
    [1003, 4, [251, 251, 251, 250]],
    [500, 1, [500]],
    // Fewer cents than periods: the last periods get nothing.
    [3, 5, [1, 1, 1, 0, 0]],
  ])("splits %i cents %i ways", (total, parts, expected) => {
    const shares = splitEvenly(total, parts);
    expect(shares).toEqual(expected);
    expect(shares.reduce((sum, cents) => sum + cents, 0)).toBe(total);
  });
});

describe("planShares", () => {
  it("adds each item's share into the periods it covers, all starting together", () => {
    expect(
      planShares([
        { amountCents: 1000, periods: 4 },
        { amountCents: 301, periods: 2 },
      ]),
    ).toEqual([
      [
        { item: 0, cents: 250 },
        { item: 1, cents: 151 },
      ],
      [
        { item: 0, cents: 250 },
        { item: 1, cents: 150 },
      ],
      [{ item: 0, cents: 250 }],
      [{ item: 0, cents: 250 }],
    ]);
  });

  it("leaves out shares of nothing, and a period with none", () => {
    expect(planShares([{ amountCents: 2, periods: 3 }])).toEqual([[{ item: 0, cents: 1 }], [{ item: 0, cents: 1 }], []]);
  });

  it("is empty for no items", () => {
    expect(planShares([])).toEqual([]);
  });
});

describe("splitNote", () => {
  const shares = [
    { item: 0, cents: 4327 },
    { item: 1, cents: 2000 },
  ];

  it.each([
    ["one item: only the note", "PayPal", [{ item: 0, cents: 4327 }], ["Laptop"], "PayPal"],
    ["one item, no note: nothing", "", [{ item: 0, cents: 4327 }], ["Laptop"], ""],
    ["several: what each makes up", undefined, shares, ["Laptop", "Couch"], "Laptop $43.27 + Couch $20.00"],
    ["several with a note: both", " PayPal ", shares, ["Laptop", "Couch"], "PayPal · Laptop $43.27 + Couch $20.00"],
    ["several, one of them finished", "", [{ item: 1, cents: 2000 }], ["Laptop", "Couch"], "Couch $20.00"],
  ])("%s", (_, note, given, labels, expected) => {
    expect(splitNote(note, given, labels)).toBe(expected);
  });
});

describe("transactionSplitSchema", () => {
  const base = { name: "PayPal", kind: "expense", occursAt: "2026-10-21T09:00" };
  const item = (label: string) => ({ label, amountCents: 1000, dueDate: "2027-03-05" });

  it("needs no item name when there is only one", () => {
    expect(transactionSplitSchema.safeParse({ ...base, items: [item("")] }).success).toBe(true);
  });

  it("needs every item named when there are several", () => {
    const result = transactionSplitSchema.safeParse({ ...base, items: [item("Laptop"), item(" ")] });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["items", 1, "label"]]);
  });

  it.each([
    ["no items", []],
    ["a bad due date", [{ label: "", amountCents: 1000, dueDate: "2027-02-30" }]],
    ["no amount", [{ label: "", amountCents: 0, dueDate: "2027-03-05" }]],
    ["eleven items", Array.from({ length: 11 }, (_, index) => item(`Thing ${index}`))],
  ])("rejects %s", (_, items) => {
    expect(transactionSplitSchema.safeParse({ ...base, items }).success).toBe(false);
  });
});

describe("laterTotal", () => {
  const payment = (amountCents: number) => ({
    occursAt: "2027-01-26T00:00",
    amountCents,
    period: { startDate: "2027-01-26", endDate: "2027-02-08" },
    shares: [],
  });

  it.each([
    ["nothing later", [], 0],
    ["expenses, as a positive amount", [payment(-96), payment(-96)], 192],
    ["income", [payment(500)], 500],
  ])("%s", (_, later, expected) => {
    expect(laterTotal({ later })).toBe(expected);
  });
});

describe("waitingStatus", () => {
  const dates = ["2027-10-22", "2027-11-05", "2027-11-19", "2027-12-03", "2027-12-17"];

  it.each([
    ["none in reach yet", "2027-10-21", { inReach: 0, remind: false }],
    ["one in reach: not worth a reminder", "2027-10-22", { inReach: 1, remind: false }],
    ["two in reach: still not", "2027-11-18", { inReach: 2, remind: false }],
    ["three in reach: remind", "2027-11-19", { inReach: 3, remind: true }],
    ["all in reach: remind", "2028-01-01", { inReach: 5, remind: true }],
  ])("%s", (_, reachEnd, expected) => {
    expect(waitingStatus(dates, reachEnd)).toEqual(expected);
  });

  it("reminds as soon as the last of a short remainder is in reach", () => {
    expect(waitingStatus(["2027-10-22"], "2027-10-22")).toEqual({ inReach: 1, remind: true });
    expect(waitingStatus(["2027-10-22", "2027-11-05"], "2027-11-05")).toEqual({ inReach: 2, remind: true });
  });
});
