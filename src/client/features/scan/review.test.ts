import { describe, expect, it } from "vitest";
import type { ScannedRow } from "../../../shared/scan.ts";
import type { Transaction, TransactionImportResponse } from "../../../shared/transactions.ts";
import { draftsFromRows, importRows, problemWith, wantsALook, withDryRun } from "./review.ts";

const row = (over: Partial<ScannedRow> = {}): ScannedRow => ({
  date: "2026-10-10",
  name: "CORNER MARKET",
  amountCents: -678,
  balanceCents: 140_000,
  confidence: 95,
  flags: [],
  ...over,
});

const dryRun = (over: Partial<TransactionImportResponse>): TransactionImportResponse => ({
  dryRun: true,
  created: 0,
  skipped: [],
  periodsAdded: { earlier: 0, later: 0 },
  periods: [],
  possibleDuplicates: [],
  countedToward: [],
  billOrIncomeSuggestions: [],
  current: null,
  ...over,
});

describe("draftsFromRows", () => {
  it("makes each row a draft, ticked unless it was hard to read or had no date", () => {
    const drafts = draftsFromRows([
      row(),
      row({ name: "PAYROLL", amountCents: 200_000, balanceCents: null }),
      row({ flags: ["hard_to_read"] }),
      row({ date: null, flags: ["no_date"] }),
      row({ name: "X".repeat(150) }),
    ]);
    expect(drafts.map(({ include, date, amount, kind, importKey }) => ({ include, date, amount, kind, importKey }))).toEqual([
      { include: true, date: "2026-10-10", amount: "6.78", kind: "expense", importKey: "scan:2026-10-10:-678:140000" },
      { include: true, date: "2026-10-10", amount: "2000.00", kind: "income", importKey: undefined },
      { include: false, date: "2026-10-10", amount: "6.78", kind: "expense", importKey: "scan:2026-10-10:-678:140000" },
      { include: false, date: "", amount: "6.78", kind: "expense", importKey: undefined },
      { include: true, date: "2026-10-10", amount: "6.78", kind: "expense", importKey: "scan:2026-10-10:-678:140000" },
    ]);
    expect(drafts[4]!.name).toHaveLength(100);
    expect(drafts.map(wantsALook)).toEqual([false, false, true, true, false]);
  });
});

describe("importRows and problemWith", () => {
  it("sends only what can be imported, paid, under its key", () => {
    const [good, noDate, noName] = draftsFromRows([row(), row({ date: null, flags: ["no_date"] }), row({ name: "" })]);
    expect([good, noDate, noName].map((draft) => problemWith(draft!))).toEqual([null, "Give it a date", "Give it a name"]);
    expect(problemWith({ ...good!, amount: "0" })).toBe("Give it an amount");
    expect(importRows([good!, noDate!, noName!], () => true)).toEqual({
      rows: [
        { name: "CORNER MARKET", amountCents: 678, kind: "expense", occursAt: "2026-10-10T00:00", paid: true, importKey: "scan:2026-10-10:-678:140000" },
      ],
      keys: ["row-0"],
    });
    expect(importRows([good!], (draft) => !draft.include).rows).toEqual([]);
  });
});

describe("withDryRun", () => {
  const existing = { id: "t1", name: "Corner Market", amountCents: -678 } as Transaction;

  it("unticks possible duplicates and what was imported before, and fills in the bill it probably pays", () => {
    const drafts = draftsFromRows([row(), row({ name: "To Loan 0300", amountCents: -20_000 }), row({ name: "OLD", amountCents: -100 })]);
    const { keys } = importRows(drafts, () => true);
    const reviewed = withDryRun(
      drafts,
      keys,
      dryRun({
        possibleDuplicates: [{ index: 0, existing, reason: "manual", daysApart: 0 }],
        billOrIncomeSuggestions: [{ index: 1, billIncomeId: "loan", billIncomeName: "Car loan", reason: "occurrence", countsToward: "entry-9" }],
        skipped: [{ index: 2, importKey: "scan:x", reason: "held" }],
      }),
    );
    expect(reviewed.map(({ include, billIncomeId, countsToward, skipped }) => ({ include, billIncomeId, countsToward, skipped }))).toEqual([
      { include: false, billIncomeId: "", countsToward: null, skipped: null },
      { include: true, billIncomeId: "loan", countsToward: "entry-9", skipped: null },
      { include: false, billIncomeId: "", countsToward: null, skipped: "held" },
    ]);
    expect(reviewed[0]!.duplicate?.existing.id).toBe("t1");

    // The entry it pays goes with the suggested bill only; choosing another drops it.
    expect(importRows([reviewed[1]!], () => true).rows[0]).toMatchObject({ billIncomeId: "loan", countsToward: "entry-9" });
    const changed = { ...reviewed[1]!, billIncomeId: "rent" };
    expect(importRows([changed], () => true).rows[0]).toMatchObject({ billIncomeId: "rent" });
    expect(importRows([changed], () => true).rows[0]).not.toHaveProperty("countsToward");
  });
});
