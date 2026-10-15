import { describe, expect, it } from "vitest";
import { searchKey } from "./transactions.ts";

describe("searchKey", () => {
  it.each([
    ["walmart", "walmart"],
    ["Wal-Mart", "walmart"],
    ["WAL MART SUPERCENTER", "walmartsupercenter"],
    ["Walmart.com", "walmartcom"],
    ["KROGER #512", "kroger512"],
    ["AT&T", "att"],
    ["McDonald's", "mcdonalds"],
    ["McDonald’s", "mcdonalds"],
    ["SQ *COFFEE", "sqcoffee"],
    ["100% juice_bar", "100%juicebar"],
    ["Café", "café"],
    ["- # -", ""],
    ["", ""],
  ])("%j → %j", (text, key) => {
    expect(searchKey(text)).toBe(key);
  });
});
