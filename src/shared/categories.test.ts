import { describe, expect, it } from "vitest";
import { categoryInputSchema, categoryLimitSchema, categoryPatchSchema, overLimitMessage } from "./categories.ts";

const limit = (spentCents: number, paidSpentCents: number, limitCents = 20_000) => ({
  categoryId: "c",
  name: "Groceries",
  limitCents,
  spentCents,
  paidSpentCents,
});

describe("overLimitMessage", () => {
  it.each([
    ["nothing spent", limit(0, 0), null],
    ["under the limit", limit(19_999, 19_999), null],
    ["exactly the limit", limit(20_000, 20_000), null],
    ["exactly the limit, part of it upcoming", limit(20_000, 12_000), null],
    [
      "over only once what is upcoming is counted",
      limit(21_500, 12_000),
      "You're set to go over your budget for Groceries by $15.00 this period.",
    ],
    [
      "paid right up to the limit, with more upcoming",
      limit(20_001, 20_000),
      "You're set to go over your budget for Groceries by $0.01 this period.",
    ],
    ["over on what is paid", limit(21_500, 21_500), "You went over your budget for Groceries by $15.00 this period."],
    [
      "over on what is paid, with more upcoming",
      limit(25_000, 21_500),
      "You went over your budget for Groceries by $15.00 this period. With what's upcoming it will be $50.00.",
    ],
    [
      // An upcoming refund is expected to bring it back under.
      "over on what is paid, but not once an upcoming refund is counted",
      limit(19_000, 21_500),
      null,
    ],
    ["a limit of zero with nothing spent", limit(0, 0, 0), null],
    ["a limit of zero with anything spent", limit(1, 1, 0), "You went over your budget for Groceries by $0.01 this period."],
    [
      "large amounts",
      limit(1_234_567, 1_234_567, 100_000),
      "You went over your budget for Groceries by $11,345.67 this period.",
    ],
  ])("%s", (_case, input, expected) => {
    expect(overLimitMessage(input)).toBe(expected);
  });
});

describe("category schemas", () => {
  it("trims the name and fills in no limit", () => {
    expect(categoryInputSchema.parse({ name: "  Groceries " })).toEqual({ name: "Groceries", defaultLimitCents: null });
  });

  it.each([
    ["an empty name", { name: " " }],
    ["a name over 40 characters", { name: "x".repeat(41) }],
    ["a negative limit", { name: "A", defaultLimitCents: -1 }],
    ["a limit that is not whole cents", { name: "A", defaultLimitCents: 1.5 }],
    ["a limit beyond the largest transaction", { name: "A", defaultLimitCents: 100_000_001 }],
  ])("refuses %s", (_case, input) => {
    expect(categoryInputSchema.safeParse(input).success).toBe(false);
  });

  it("never fills in a field a patch did not send", () => {
    expect(categoryPatchSchema.parse({ name: "Food" })).toEqual({ name: "Food" });
    expect(categoryPatchSchema.parse({ defaultLimitCents: null })).toEqual({ defaultLimitCents: null });
    expect(categoryPatchSchema.safeParse({}).success).toBe(false);
  });

  it("takes zero as a period's limit, and nothing below", () => {
    expect(categoryLimitSchema.parse({ limitCents: 0 })).toEqual({ limitCents: 0 });
    expect(categoryLimitSchema.safeParse({ limitCents: -1 }).success).toBe(false);
    expect(categoryLimitSchema.safeParse({}).success).toBe(false);
  });
});
