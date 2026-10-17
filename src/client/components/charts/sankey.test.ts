import { describe, expect, it } from "vitest";
import { fitName, LABEL_SPACING, layoutSankey, NODE_GAP } from "./sankey.ts";

describe("layoutSankey", () => {
  const node = (key: string, value: number) => ({ key, name: key, color: "red", value });
  const data = {
    sources: [node("pay", 300), node("side", 100), node("nothing", 0)],
    total: { name: "Income", value: 400 },
    uses: [node("kept", 50), node("rent", 200), node("food", 100), node("fun", 50)],
  };
  const tol = 1e-9;

  it("makes every band as thick as its money, on one scale, so both sides fill the middle bar", () => {
    const { nodes, height } = layoutSankey(data, 800);
    const of = (key: string) => nodes.find((entry) => entry.key === key)!;
    const middle = of("total");
    expect(of("rent").height / of("food").height).toBeCloseTo(2, 9);
    expect(of("pay").height + of("side").height).toBeCloseTo(middle.height, 9);
    expect(["kept", "rent", "food", "fun"].reduce((sum, key) => sum + of(key).height, 0)).toBeCloseTo(middle.height, 9);
    for (const entry of nodes) {
      expect(entry.y).toBeGreaterThanOrEqual(-tol);
      expect(entry.y + entry.height).toBeLessThanOrEqual(height + tol);
    }
  });

  it("leaves out what has no money, and puts sources, total and uses left to right", () => {
    const { nodes } = layoutSankey(data, 800);
    expect(nodes.map((entry) => entry.key)).toEqual(["pay", "side", "total", "kept", "rent", "food", "fun"]);
    const xOf = (side: string) => nodes.find((entry) => entry.side === side)!.x;
    expect(xOf("source")).toBeLessThan(xOf("total"));
    expect(xOf("total")).toBeLessThan(xOf("use"));
  });

  it("keeps every label level with its own bar, spreading slivers apart to make room", () => {
    const slivers = { ...data, uses: [node("big", 396), node("a", 1), node("b", 1), node("c", 1), node("d", 1)] };
    const { nodes, labels, height } = layoutSankey(slivers, 800);
    const right = nodes.filter((entry) => entry.side === "use");
    for (const bar of right) {
      expect(labels.find((entry) => entry.key === bar.key)!.y).toBeCloseTo(bar.y + bar.height / 2, 9);
    }
    for (let i = 1; i < right.length; i++) {
      const [above, below] = [right[i - 1]!, right[i]!];
      expect(below.y - (above.y + above.height)).toBeGreaterThanOrEqual(NODE_GAP - tol);
      expect(below.y + below.height / 2 - (above.y + above.height / 2)).toBeGreaterThanOrEqual(LABEL_SPACING - tol);
    }
    const ys = labels.map((entry) => entry.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(LABEL_SPACING / 2 - tol);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height - LABEL_SPACING / 2 + tol);
  });

  it("grows taller with more to label, and names the total above the chart when a phone is too narrow for it", () => {
    const many = { ...data, uses: Array.from({ length: 10 }, (_, n) => node(`u${n}`, 40)) };
    expect(layoutSankey(many, 800).height).toBeGreaterThanOrEqual(10 * LABEL_SPACING);
    expect(layoutSankey(data, 800).totalLabelled).toBe(true);
    expect(layoutSankey(data, 300).totalLabelled).toBe(false);
    expect(layoutSankey(data, 300).labels.map((entry) => entry.key)).not.toContain("total");
  });
});

describe("fitName", () => {
  it.each([
    ["Rent", 10, "Rent"],
    ["Groceries and household", 10, "Groceries…"],
  ] as const)("%s in %i", (name, max, expected) => {
    expect(fitName(name, max)).toBe(expected);
  });
});
