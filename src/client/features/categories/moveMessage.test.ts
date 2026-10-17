import { describe, expect, it } from "vitest";
import { moveMessage } from "./moveMessage.ts";

describe("moveMessage", () => {
  it.each([
    [{ transactions: 12, billsIncome: 2, deleted: false }, "Moved 12 transactions and 2 bills and income to Food."],
    [{ transactions: 1, billsIncome: 1, deleted: false }, "Moved 1 transaction and 1 bill or income to Food."],
    [{ transactions: 3, billsIncome: 0, deleted: true }, "Moved 3 transactions to Food. Groceries is deleted."],
    [{ transactions: 0, billsIncome: 2, deleted: false }, "Moved 2 bills and income to Food."],
    [{ transactions: 0, billsIncome: 0, deleted: false }, "Groceries had nothing filed under it."],
    [{ transactions: 0, billsIncome: 0, deleted: true }, "Groceries had nothing filed under it. Groceries is deleted."],
  ])("%j", (result, expected) => {
    expect(moveMessage(result, "Groceries", "Food")).toBe(expected);
  });
});
