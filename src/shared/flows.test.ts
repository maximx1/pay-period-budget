import { describe, expect, it } from "vitest";
import { type FlowSource, netTransfers } from "./flows.ts";

const tx = (amountCents: number, billIncomeId: string | null = null, categoryId: string | null = null): FlowSource => ({
  amountCents,
  billIncomeId,
  categoryId,
});
const transfers = new Map([
  ["savings", { categoryId: "saving" }],
  ["joint", { categoryId: null }],
]);
const amounts = (source: FlowSource[]) =>
  netTransfers(source, transfers).map(({ amountCents, billIncomeId, categoryId, transfer }) => [amountCents, billIncomeId, categoryId, transfer]);

describe("netTransfers", () => {
  it.each<[string, FlowSource[], unknown[][]]>([
    ["$300 sent and $100 brought back is $200 sent", [tx(-30_000, "savings"), tx(10_000, "savings")], [[-20_000, "savings", "saving", true]]],
    ["more brought back than sent is money in", [tx(-5_000, "joint"), tx(8_000, "joint")], [[3_000, "joint", null, true]]],
    ["sent and brought back alike comes to nothing", [tx(-5_000, "joint"), tx(5_000, "joint")], []],
    [
      "each transfer is netted by itself, under its own category whatever its transactions say",
      [tx(-1_000, "savings", "food"), tx(-2_000, "joint"), tx(500, "savings")],
      [
        [-500, "savings", "saving", true],
        [-2_000, "joint", null, true],
      ],
    ],
    [
      "everything else passes through as it is, ahead of the transfers",
      [tx(-2_000, "joint"), tx(200_000, "pay"), tx(-4_000, null, "food"), tx(-4_000, null, "food")],
      [
        [200_000, "pay", null, false],
        [-4_000, null, "food", false],
        [-4_000, null, "food", false],
        [-2_000, "joint", null, true],
      ],
    ],
    ["nothing at all", [], []],
  ])("%s", (_, source, expected) => {
    expect(amounts(source)).toEqual(expected);
  });

  it("keeps the total: netting moves no money", () => {
    const source = [tx(-30_000, "savings"), tx(200_000, "pay"), tx(10_000, "savings"), tx(-7_000, "joint"), tx(-1_234)];
    const total = (entries: { amountCents: number }[]) => entries.reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(total(netTransfers(source, transfers))).toBe(total(source));
  });
});
