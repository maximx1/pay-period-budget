import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../shared/transactions.ts";
import { newestFirst } from "./sectionOrder.ts";

const at = (name: string, occursAt: string) => ({ id: name, name, occursAt }) as Transaction;

describe("newestFirst", () => {
  it("puts later days and times above earlier ones, and keeps rows at the same moment in their own order", () => {
    // As the server sends them: oldest first, then the order chosen with Reorder.
    const sent = [
      at("rent", "2026-10-08T00:00"),
      at("coffee", "2026-10-09T08:15"),
      at("second", "2026-10-09T12:00"),
      at("first", "2026-10-09T12:00"),
      at("third", "2026-10-09T12:00"),
      at("dinner", "2026-10-09T19:30"),
      at("gas", "2026-10-11T00:00"),
    ];
    expect(newestFirst(sent).map((transaction) => transaction.name)).toEqual([
      "gas",
      "dinner",
      "second",
      "first",
      "third",
      "coffee",
      "rent",
    ]);
    expect(sent[0]!.name).toBe("rent");
  });
});
