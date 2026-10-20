import { describe, expect, it } from "vitest";
import { isFiltering, matchesPeriodFilter, NO_CATEGORY, NO_FILTER, type PeriodFilter } from "./periodFilter.ts";

const kroger = { name: "KROGER #512", note: "milk and eggs", amountCents: -4_599, categoryId: "groceries" };
const paycheck = { name: "Paycheck", note: null, amountCents: 215_000, categoryId: null };

const text = (value: string): PeriodFilter => ({ text: value, categoryIds: new Set() });
const categories = (...ids: string[]): PeriodFilter => ({ text: "", categoryIds: new Set(ids) });

describe("matchesPeriodFilter", () => {
  it.each<[string, PeriodFilter, boolean]>([
    ["nothing chosen shows everything", NO_FILTER, true],
    ["spaces alone are nothing", text("   "), true],
    ["part of the name, any case", text("kroger"), true],
    ["the name without its punctuation", text("kroger 512"), true],
    ["part of the note", text("EGGS"), true],
    ["the category's name", text("grocer"), true],
    ["something it doesn't say", text("target"), false],
    ["whole dollars, either direction", text("45"), true],
    ["whole dollars with a sign and a $", text("-$45"), true],
    ["not a larger amount ending in it", text("145"), false],
    ["the cents typed so far", text("45.9"), true],
    ["other cents typed so far", text("45.5"), false],
    ["the cents exactly", text("45.99"), true],
    ["the wrong cents", text("45.98"), false],
    ["a category chosen", categories("groceries"), true],
    ["another category chosen", categories("fuel"), false],
    ["one of several", categories("fuel", "groceries"), true],
    ["category and text must both agree", { text: "target", categoryIds: new Set(["groceries"]) }, false],
  ])("%s", (_, filter, expected) => {
    expect(matchesPeriodFilter(kroger, filter, "Groceries")).toBe(expected);
  });

  it.each<[string, PeriodFilter, boolean]>([
    ["no category, when asked for", categories(NO_CATEGORY), true],
    ["no category, when a category is asked for", categories("groceries"), false],
    ["a large amount with a comma", text("2,150"), true],
    ["a large amount without one", text("2150.00"), true],
    ["text that is all punctuation looks for it as typed", text("#"), false],
  ])("%s", (_, filter, expected) => {
    expect(matchesPeriodFilter(paycheck, filter)).toBe(expected);
  });
});

describe("isFiltering", () => {
  it("is on with text or a category, and off with neither", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering(text(" "))).toBe(false);
    expect(isFiltering(text("a"))).toBe(true);
    expect(isFiltering(categories(NO_CATEGORY))).toBe(true);
  });
});
