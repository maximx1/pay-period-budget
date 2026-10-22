import { describe, expect, it } from "vitest";
import {
  fitShares,
  laterTotal,
  planSplit,
  SPLIT_ROUND_CENTS,
  splitAddSchema,
  splitEvenly,
  splitNote,
  transactionSplitSchema,
  waitingStatus,
} from "./split.ts";

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

/** Each payment as [seq, total, ...each item's share] for reading at a glance. */
const summary = (payments: ReturnType<typeof planSplit>["payments"], items: number) =>
  payments.map(({ seq, shares }) => [
    seq,
    shares.reduce((sum, share) => sum + share.cents, 0),
    ...Array.from({ length: items }, (_, item) => shares.find((share) => share.item === item)?.cents ?? 0),
  ]);

describe("planSplit", () => {
  it("adds each item's share into the periods it covers, all starting together", () => {
    const { payments, stranded } = planSplit({
      items: [
        { leftCents: 1000, firstSeq: 3, lastSeq: 6 },
        { leftCents: 301, firstSeq: 3, lastSeq: 4 },
      ],
      fromSeq: 3,
    });
    expect(stranded).toEqual([]);
    expect(summary(payments, 2)).toEqual([
      [3, 401, 250, 151],
      [4, 400, 250, 150],
      [5, 250, 250, 0],
      [6, 250, 250, 0],
    ]);
  });

  it("leaves out shares of nothing, and a period with none", () => {
    expect(summary(planSplit({ items: [{ leftCents: 2, firstSeq: 0, lastSeq: 2 }], fromSeq: 0 }).payments, 1)).toEqual([
      [0, 1, 1],
      [1, 1, 1],
    ]);
  });

  it("is empty for no items, and for items with nothing left", () => {
    expect(planSplit({ items: [], fromSeq: 0 })).toEqual({ payments: [], stranded: [] });
    expect(planSplit({ items: [{ leftCents: 0, firstSeq: 0, lastSeq: 3 }], fromSeq: 0 })).toEqual({ payments: [], stranded: [] });
  });

  it("spreads over the open periods only, from fromSeq on", () => {
    const { payments } = planSplit({ items: [{ leftCents: 900, firstSeq: 0, lastSeq: 5 }], fromSeq: 2, closed: new Set([3]) });
    expect(summary(payments, 1)).toEqual([
      [2, 300, 300],
      [4, 300, 300],
      [5, 300, 300],
    ]);
  });

  it("starts an item no sooner than its own first period", () => {
    const { payments } = planSplit({
      items: [
        { leftCents: 400, firstSeq: 0, lastSeq: 3 },
        { leftCents: 200, firstSeq: 2, lastSeq: 3 },
      ],
      fromSeq: 0,
    });
    expect(summary(payments, 2)).toEqual([
      [0, 100, 100, 0],
      [1, 100, 100, 0],
      [2, 200, 100, 100],
      [3, 200, 100, 100],
    ]);
  });

  it("reports an item with something left and no open period, and plans the rest", () => {
    const { payments, stranded } = planSplit({
      items: [
        { leftCents: 500, firstSeq: 0, lastSeq: 4 },
        { leftCents: 100, firstSeq: 0, lastSeq: 2 },
      ],
      fromSeq: 3,
    });
    expect(stranded).toEqual([1]);
    expect(summary(payments, 2)).toEqual([
      [3, 250, 250, 0],
      [4, 250, 250, 0],
    ]);
  });

  describe("rounding each period's payment up", () => {
    it("pays $975.30 over six periods as four of $200 and the rest, dropping the sixth", () => {
      // An even split would be $162.55 a period.
      const { payments } = planSplit({
        items: [{ leftCents: 97_530, firstSeq: 0, lastSeq: 5 }],
        fromSeq: 0,
        roundToCents: SPLIT_ROUND_CENTS,
      });
      expect(summary(payments, 1)).toEqual([
        [0, 20_000, 20_000],
        [1, 20_000, 20_000],
        [2, 20_000, 20_000],
        [3, 20_000, 20_000],
        [4, 17_530, 17_530],
      ]);
    });

    it("rounds the period's total, not each item's share", () => {
      // Three items of $12 a period: $36 rounds to $50, not three $50s.
      const { payments } = planSplit({
        items: [0, 1, 2].map(() => ({ leftCents: 4_800, firstSeq: 0, lastSeq: 3 })),
        fromSeq: 0,
        roundToCents: SPLIT_ROUND_CENTS,
      });
      expect(summary(payments, 3)).toEqual([
        // The extra $14 goes to the first of the items due soonest (all the same here: the first listed).
        [0, 5_000, 2_600, 1_200, 1_200],
        [1, 5_000, 2_200, 1_600, 1_200],
        // What is left, $44: three payments instead of four.
        [2, 4_400, 0, 2_000, 2_400],
      ]);
    });

    it("leaves a total already on a multiple of $50 as it is", () => {
      const { payments } = planSplit({
        items: [{ leftCents: 30_000, firstSeq: 0, lastSeq: 2 }],
        fromSeq: 0,
        roundToCents: SPLIT_ROUND_CENTS,
      });
      expect(summary(payments, 1)).toEqual([
        [0, 10_000, 10_000],
        [1, 10_000, 10_000],
        [2, 10_000, 10_000],
      ]);
    });

    it("puts the extra on the item due soonest, so it finishes early", () => {
      const { payments } = planSplit({
        items: [
          { leftCents: 50_000, firstSeq: 0, lastSeq: 9 },
          { leftCents: 12_000, firstSeq: 0, lastSeq: 3 },
        ],
        fromSeq: 0,
        roundToCents: SPLIT_ROUND_CENTS,
      });
      // Even: $50 + $30 = $80 a period for four, then $50: rounded, $100 then $50, and one
      // payment fewer than the even split's ten.
      expect(summary(payments, 2)).toEqual([
        [0, 10_000, 5_000, 5_000],
        [1, 10_000, 5_000, 5_000],
        [2, 10_000, 8_000, 2_000],
        [3, 10_000, 10_000, 0],
        [4, 5_000, 5_000, 0],
        [5, 5_000, 5_000, 0],
        [6, 5_000, 5_000, 0],
        [7, 5_000, 5_000, 0],
        [8, 2_000, 2_000, 0],
      ]);
    });

    it.each([
      ["one item", [{ leftCents: 43_267, firstSeq: 0, lastSeq: 10 }]],
      [
        "items due at different times",
        [
          { leftCents: 43_267, firstSeq: 0, lastSeq: 10 },
          { leftCents: 12_001, firstSeq: 0, lastSeq: 3 },
          { leftCents: 999, firstSeq: 2, lastSeq: 7 },
        ],
      ],
    ])("pays every item in full by its last period: %s", (_, items) => {
      const plain = planSplit({ items, fromSeq: 0 }).payments;
      const rounded = planSplit({ items, fromSeq: 0, roundToCents: SPLIT_ROUND_CENTS }).payments;
      for (const [item, { leftCents, lastSeq }] of items.entries()) {
        const paidBy = (payments: typeof plain, seq: number) =>
          payments
            .filter((payment) => payment.seq <= seq)
            .reduce((sum, payment) => sum + (payment.shares.find((share) => share.item === item)?.cents ?? 0), 0);
        expect(paidBy(rounded, lastSeq)).toBe(leftCents);
        // Never behind the even split.
        for (let seq = 0; seq <= lastSeq; seq++) expect(paidBy(rounded, seq)).toBeGreaterThanOrEqual(paidBy(plain, seq));
      }
      for (const payment of rounded.slice(0, -1)) {
        expect(payment.shares.reduce((sum, share) => sum + share.cents, 0) % SPLIT_ROUND_CENTS).toBe(0);
      }
    });
  });
});

describe("fitShares", () => {
  const soonestFirst = [1, 0];

  it.each([
    ["adds up already: as it is", 500, [{ item: 0, cents: 300 }, { item: 1, cents: 200 }], [1000, 1000], [{ item: 0, cents: 300 }, { item: 1, cents: 200 }]],
    ["short: off the item due last first", 400, [{ item: 0, cents: 300 }, { item: 1, cents: 200 }], [1000, 1000], [{ item: 0, cents: 200 }, { item: 1, cents: 200 }]],
    ["far short: then off the next", 100, [{ item: 0, cents: 300 }, { item: 1, cents: 200 }], [1000, 1000], [{ item: 1, cents: 100 }]],
    ["over: to the item due soonest", 700, [{ item: 0, cents: 300 }, { item: 1, cents: 200 }], [1000, 1000], [{ item: 0, cents: 300 }, { item: 1, cents: 400 }]],
    ["over its room: the rest to the next", 700, [{ item: 0, cents: 300 }, { item: 1, cents: 200 }], [1000, 250], [{ item: 0, cents: 450 }, { item: 1, cents: 250 }]],
    ["over everything: the excess counts toward nothing", 5000, [{ item: 0, cents: 300 }], [400, 100], [{ item: 0, cents: 400 }, { item: 1, cents: 100 }]],
  ])("%s", (_, amount, shares, room, expected) => {
    expect(fitShares(amount, shares, soonestFirst, room)).toEqual(expected);
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

describe("splitAddSchema", () => {
  const base = { occursAt: "2026-10-21T09:00" };

  it("needs every new item named, even one alone, since it joins what is there", () => {
    const result = splitAddSchema.safeParse({ ...base, items: [{ label: "", amountCents: 1000, dueDate: "2027-03-05" }] });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["items", 0, "label"]]);
    expect(splitAddSchema.safeParse({ ...base, items: [{ label: "Couch", amountCents: 1000, dueDate: "2027-03-05" }] }).success).toBe(true);
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
