import { describe, expect, it } from "vitest";
import { mergeScans, type OcrWord, parseDate, parseMoney, rowsFromWords, type ScannedRow, scanImportKey } from "./scan.ts";

// Screenshots are described here as the words text recognition would find in them, laid
// out like the real ones the reader was built against (a phone app, a bank's website, a
// card statement) but with made-up names and amounts.

const CHAR = 0.55;
type Style = { size?: number; confidence?: number };

/** `text` written from `x`, with its top at `y`, a box per word. */
function write(x: number, y: number, text: string, { size = 30, confidence = 95 }: Style = {}): OcrWord[] {
  const words: OcrWord[] = [];
  let cursor = x;
  for (const part of text.split(" ")) {
    const width = part.length * size * CHAR;
    words.push({ text: part, x0: cursor, y0: y, x1: cursor + width, y1: y + size, confidence });
    cursor += width + size * 0.3;
  }
  return words;
}
/** `text` written so that it ends at `right`. */
function writeRight(right: number, y: number, text: string, style: Style = {}): OcrWord[] {
  const size = style.size ?? 30;
  const width = text.length * size * CHAR + (text.split(" ").length - 1) * size * 0.3;
  return write(right - width, y, text, style);
}

const TODAY = "2026-10-14";
const rows = (words: OcrWord[], today = TODAY) =>
  rowsFromWords(words, today).map(({ date, name, amountCents, balanceCents, flags }) => ({ date, name, amountCents, balanceCents, flags }));

describe("rowsFromWords", () => {
  it("reads a phone app: the amount beside the name, the balance under it beside the date", () => {
    const phone = [
      ...write(110, 80, "1:42", { size: 24 }),
      ...writeRight(1030, 80, "75", { size: 24 }),
      ...write(100, 200, "< Big Bank Checking Q", { size: 50 }),
      // One transaction: name and amount, then date and balance.
      ...write(70, 500, "To Savings 0200", { size: 40 }),
      ...writeRight(1090, 500, "-$150.00", { size: 40 }),
      ...write(70, 560, "Oct 10, 2026", { size: 32 }),
      ...writeRight(1090, 560, "$1,250.00", { size: 32 }),
      // A name over two lines, the second cut off with an ellipsis.
      ...write(70, 760, "#5551234 CORNER MARKET", { size: 40 }),
      ...writeRight(1090, 760, "-$6.78", { size: 40 }),
      ...write(70, 820, "#42 MAIN ST SPRINGFIELD...", { size: 40 }),
      ...writeRight(1090, 820, "$1,400.00", { size: 32 }),
      ...write(70, 880, "Oct 09, 2026", { size: 32 }),
      // Money in, shown without a sign.
      ...write(70, 1020, "ACME CO TYPE: PAYROLL", { size: 40 }),
      ...writeRight(1090, 1020, "$2,000.00", { size: 40 }),
      ...write(70, 1080, "CO: ACME", { size: 40 }),
      ...writeRight(1090, 1080, "$1,406.78", { size: 32 }),
      ...write(70, 1140, "Oct 09, 2026", { size: 32 }),
    ];
    expect(rows(phone)).toEqual([
      { date: "2026-10-10", name: "To Savings 0200", amountCents: -15_000, balanceCents: 125_000, flags: [] },
      { date: "2026-10-09", name: "#5551234 CORNER MARKET #42 MAIN ST SPRINGFIELD", amountCents: -678, balanceCents: 140_000, flags: [] },
      { date: "2026-10-09", name: "ACME CO TYPE: PAYROLL CO: ACME", amountCents: 200_000, balanceCents: 140_678, flags: [] },
    ]);
  });

  it("reads a bank's website: the date stacked in a column, amount and balance side by side", () => {
    const row = (top: number, day: string, name: string, amount: string, balance: string) => [
      ...write(100, top, "OCT", { size: 26 }),
      ...write(214, top, name, { size: 26 }),
      ...write(106, top + 32, day, { size: 27 }),
      ...writeRight(1599, top + 32, amount, { size: 27 }),
      ...writeRight(1870, top + 32, balance, { size: 27 }),
      ...write(226, top + 58, "Add a category", { size: 20 }),
      ...write(103, top + 79, "2026", { size: 13 }),
    ];
    const website = [
      ...row(30, "10", "To Loan 0300", "-$200.00", "$1,472.83"),
      ...row(195, "9", "ACME CO PAYROLL", "$2,000.00", "$1,672.83"),
      // The day misread as a mark: month and year but no day.
      ...row(360, "°", "#5551234 CORNER MARKET", "-$14.19", "$1,086.97"),
    ];
    expect(rows(website)).toEqual([
      { date: "2026-10-10", name: "To Loan 0300", amountCents: -20_000, balanceCents: 147_283, flags: [] },
      { date: "2026-10-09", name: "ACME CO PAYROLL", amountCents: 200_000, balanceCents: 167_283, flags: [] },
      { date: null, name: "#5551234 CORNER MARKET", amountCents: -1_419, balanceCents: 108_697, flags: ["no_date"] },
    ]);
  });

  it("reads a list under date headings, and a card statement that marks nothing as spending", () => {
    const statement = [
      ...write(40, 100, "Today", { size: 28 }),
      ...write(40, 170, "COFFEE HOUSE"),
      ...writeRight(900, 170, "4.50"),
      ...write(40, 240, "GAS STATION 12"),
      ...writeRight(900, 240, "32.10"),
      ...write(40, 330, "Oct 8", { size: 28 }),
      ...write(40, 400, "BOOKSTORE"),
      ...writeRight(900, 400, "18.00"),
      ...write(40, 470, "BOOKSTORE REFUND"),
      ...writeRight(900, 470, "18.00 CR"),
    ];
    expect(rows(statement)).toEqual([
      { date: "2026-10-14", name: "COFFEE HOUSE", amountCents: -450, balanceCents: null, flags: [] },
      { date: "2026-10-14", name: "GAS STATION 12", amountCents: -3_210, balanceCents: null, flags: [] },
      { date: "2026-10-08", name: "BOOKSTORE", amountCents: -1_800, balanceCents: null, flags: [] },
      { date: "2026-10-08", name: "BOOKSTORE REFUND", amountCents: 1_800, balanceCents: null, flags: [] },
    ]);
  });

  it("flags what was hard to read, and reads common misreadings of an amount", () => {
    const misread = [
      ...write(70, 100, "O LOd U UU", { size: 40, confidence: 30 }),
      ...writeRight(1090, 100, "-$1/5.00", { size: 40, confidence: 40 }),
      ...write(70, 160, "Oct 10, 2026", { size: 32 }),
      ...writeRight(1090, 160, "$6:565.92", { size: 32 }),
      ...write(70, 360, "CORNER MARKET", { size: 40 }),
      ...writeRight(1090, 360, "-$14.19", { size: 40 }),
      ...write(70, 420, "Oct 07, 2026", { size: 32 }),
      ...writeRight(1090, 420, "$3825.89", { size: 32 }),
    ];
    expect(rows(misread)).toEqual([
      // "-$1/5.00" is no amount, so the balance is the only one: read, but flagged.
      { date: "2026-10-10", name: "O LOd U UU", amountCents: 656_592, balanceCents: null, flags: ["hard_to_read"] },
      { date: "2026-10-07", name: "CORNER MARKET", amountCents: -1_419, balanceCents: 382_589, flags: [] },
    ]);
  });

  it("gives a date without a year the latest one that is not in the future", () => {
    const list = [...write(40, 100, "Dec 30 BAKERY"), ...writeRight(900, 100, "-$9.00")];
    // "Dec 30 BAKERY" is one cell, so it is no date by itself: nothing to go on.
    expect(rows(list, "2026-01-05")[0]!.flags).toEqual(["no_date"]);
    const split = [...write(40, 100, "Dec 30"), ...write(400, 100, "BAKERY"), ...writeRight(900, 100, "-$9.00")];
    expect(rows(split, "2026-01-05")[0]).toMatchObject({ date: "2025-12-30", name: "BAKERY", amountCents: -900 });
  });

  it("finds nothing in a picture with no amounts in it", () => {
    expect(rows([...write(40, 100, "Hello there"), ...write(40, 200, "Oct 10, 2026")])).toEqual([]);
    expect(rows([])).toEqual([]);
  });
});

describe("parseMoney", () => {
  it.each<[string, { cents: number; sign: "-" | "+" | null } | null]>([
    ["-$1,234.56", { cents: 123_456, sign: "-" }],
    ["$12.00", { cents: 1_200, sign: null }],
    ["+3.20", { cents: 320, sign: "+" }],
    ["(4.50)", { cents: 450, sign: "-" }],
    ["$(4.50)", null],
    ["12.00 CR", { cents: 1_200, sign: "+" }],
    ["12.00DR", { cents: 1_200, sign: "-" }],
    ["−$7.25", { cents: 725, sign: "-" }],
    ["- $7.25", { cents: 725, sign: "-" }],
    ["$6:565.92", { cents: 656_592, sign: null }],
    ["$3825.89", { cents: 382_589, sign: null }],
    ["1.234,56", { cents: 123_456, sign: null }],
    ["#628200283843", null],
    ["2026", null],
    ["414", null],
    ["$12.5", null],
    ["12.345", null],
    ["$1234567890.00", null],
  ])("%s", (text, expected) => {
    expect(parseMoney(text)).toEqual(expected);
  });
});

describe("parseDate", () => {
  it.each<[string, string | null]>([
    ["Oct 10, 2026", "2026-10-10"],
    ["Oct10,2026", "2026-10-10"],
    ["October 9 2026", "2026-10-09"],
    ["Sept 9, 2026", "2026-09-09"],
    ["10 Oct 2026", "2026-10-10"],
    ["10/09/2026", "2026-10-09"],
    ["10/09/26", "2026-10-09"],
    ["2026-10-09", "2026-10-09"],
    ["Oct 10", "2026-10-10"],
    ["Oct 20", "2025-10-20"],
    ["10/20", "2025-10-20"],
    ["Today", "2026-10-14"],
    ["yesterday", "2026-10-13"],
    ["Feb 30, 2026", null],
    ["Loan 2301", null],
    ["To Share 0004", null],
    ["", null],
  ])("%s", (text, expected) => {
    expect(parseDate(text, TODAY)).toBe(expected);
  });
});

describe("mergeScans and scanImportKey", () => {
  const row = (name: string, amountCents: number, balanceCents: number | null, confidence = 90): ScannedRow => ({
    date: "2026-10-10",
    name,
    amountCents,
    balanceCents,
    confidence,
    flags: [],
  });

  it("keeps a row two screenshots share once, the better-read copy, and like rows within one screenshot both", () => {
    const first = [row("To Loan 0300", -20_000, 147_283, 80), row("COFFEE", -450, null), row("COFFEE", -450, null)];
    const second = [row("To Loan 0300", -20_000, 147_283, 95), row("coffee", -450, null), row("To Share 0004", -3_000, 167_283)];
    const merged = mergeScans([first, second]);
    expect(merged.map((entry) => [entry.name, entry.confidence])).toEqual([
      ["To Loan 0300", 95],
      ["COFFEE", 90],
      ["COFFEE", 90],
      ["To Share 0004", 90],
    ]);
  });

  it("knows a row whose date was misread in one screenshot by its amount and balance, and keeps the dated copy", () => {
    const misread = { ...row("CORNER MARKET", -678, 656_592, 95), date: null, flags: ["no_date" as const] };
    const dated = row("CORNER MARKET #42", -678, 656_592, 60);
    expect(mergeScans([[misread], [dated]])).toEqual([dated]);
    // Two dates that differ are two rows, balance or not.
    expect(mergeScans([[row("A", -1, 5)], [{ ...row("A", -1, 5), date: "2026-10-11" }]])).toHaveLength(2);
  });

  it("makes an import key only where a balance tells like rows apart", () => {
    expect(scanImportKey(row("To Loan 0300", -20_000, 147_283))).toBe("scan:2026-10-10:-20000:147283");
    expect(scanImportKey(row("COFFEE", -450, null))).toBeUndefined();
    expect(scanImportKey({ ...row("X", -1, 5), date: null })).toBeUndefined();
  });
});
