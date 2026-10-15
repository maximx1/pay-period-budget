import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { rowsFromWords } from "../../shared/scan.ts";
import { createTesseractEngine } from "./ocr.ts";

// tesseract.js itself, on a made-up bank list drawn like a phone app's (names and amounts
// invented; see fixtures/). Slower than the rest: the worker and its language data load.

const engine = createTesseractEngine();
afterAll(() => engine.close());

describe("the built-in reader", () => {
  it("reads a screenshot into the transactions it shows", { timeout: 30_000 }, async () => {
    const image = readFileSync(new URL("./fixtures/made-up-bank-list.jpg", import.meta.url));
    const rows = rowsFromWords(await engine.read(image), "2026-10-14");
    expect(rows.map(({ date, name, amountCents, balanceCents, flags }) => ({ date, name, amountCents, balanceCents, flags }))).toEqual([
      { date: "2026-10-10", name: "To Savings 0200", amountCents: -15_000, balanceCents: 125_000, flags: [] },
      { date: "2026-10-09", name: "CORNER MARKET #42", amountCents: -678, balanceCents: 140_000, flags: [] },
      { date: "2026-10-09", name: "ACME CO PAYROLL", amountCents: 200_000, balanceCents: 140_678, flags: [] },
    ]);
  });

  it("throws for something that isn't a picture, and reads the next one after", { timeout: 30_000 }, async () => {
    await expect(engine.read(new TextEncoder().encode("not a picture"))).rejects.toBeDefined();
    const image = readFileSync(new URL("./fixtures/made-up-bank-list.jpg", import.meta.url));
    expect(rowsFromWords(await engine.read(image), "2026-10-14")).toHaveLength(3);
  });
});
