// Reading transactions out of a screenshot of a bank's transaction list. Text recognition
// gives words and where they sit; this works out which words make which transaction,
// whatever the bank's layout. Pure: no I/O, no DOM. See docs/plan/phase-21-screenshot-import.md.

import { z } from "zod";
import { addDays, isLocalDate, type LocalDate } from "./dates.ts";

/** A word as text recognition found it: its box in image pixels, and how sure it was (0 to 100). */
export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number };

/** Why a row wants a look before it is imported. Such a row starts unticked. */
export type ScanFlag = "hard_to_read" | "no_date";

/** One transaction read from a screenshot. */
export type ScannedRow = {
  /** Null when no date could be read; it has to be given before the row can be imported. */
  date: LocalDate | null;
  name: string;
  /** Signed: negative for money out. */
  amountCents: number;
  /** The running balance shown beside it, when the screenshot has one. */
  balanceCents: number | null;
  /** The least sure the reader was of any word in the name or the amount, 0 to 100. */
  confidence: number;
  flags: ScanFlag[];
};

export type ScanResponse = {
  rows: ScannedRow[];
  /** Which reader produced the rows: the built-in one, or the model configured on the server. */
  reader: "built_in" | "model";
  /** Something the person should know, e.g. that the model failed and the built-in reader was used. */
  notice: string | null;
};

/** The largest screenshot the server reads. */
export const MAX_SCAN_BYTES = 10 * 1024 * 1024;
/** Below this the reader was unsure of a word, and the row is flagged. */
export const LOW_CONFIDENCE = 60;

/** What a model is asked to answer with, checked before it is believed. */
export const modelAnswerSchema = z.object({
  transactions: z
    .array(
      z.object({
        date: z.string().nullable().optional(),
        description: z.string().max(500).default(""),
        amount: z.number().finite(),
        balance: z.number().finite().nullable().optional(),
      }),
    )
    .max(200),
});

// ---- cells: the pieces of a line, split where the words are far apart

type Cell = { text: string; words: OcrWord[]; x0: number; x1: number; line: number };
type Line = { words: OcrWord[]; y0: number; y1: number; height: number };

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Groups words into lines by how much they overlap vertically, top to bottom, each left to right. */
function toLines(words: readonly OcrWord[]): Line[] {
  const lines: Line[] = [];
  for (const word of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    if (!word.text.trim()) continue;
    const middle = (word.y0 + word.y1) / 2;
    const line = lines.find((candidate) => middle > candidate.y0 && middle < candidate.y1);
    if (line) {
      line.words.push(word);
      line.y0 = Math.min(line.y0, word.y0);
      line.y1 = Math.max(line.y1, word.y1);
    } else lines.push({ words: [word], y0: word.y0, y1: word.y1, height: 0 });
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.x0 - b.x0);
    line.height = median(line.words.map((word) => word.y1 - word.y0));
  }
  return lines.sort((a, b) => a.y0 - b.y0);
}

/**
 * Splits a line into cells at gaps wider than its words are tall: a date column, the
 * description and the amounts become separate cells. An amount is always a cell of its
 * own, with a lone sign before it joined to it.
 */
function toCells(line: Line, index: number): Cell[] {
  const cells: Cell[] = [];
  let current: OcrWord[] = [];
  const close = () => {
    if (current.length) {
      cells.push({
        text: current.map((word) => word.text).join(" "),
        words: current,
        x0: current[0]!.x0,
        x1: current.at(-1)!.x1,
        line: index,
      });
    }
    current = [];
  };
  const isMoney = (word: OcrWord | undefined) => word !== undefined && parseMoney(word.text) !== null;
  const isSign = (word: OcrWord | undefined) => word !== undefined && /^[-−–+]$/.test(word.text);
  for (const [position, word] of line.words.entries()) {
    const previous = line.words[position - 1];
    const next = line.words[position + 1];
    const signOfNext = isSign(word) && isMoney(next);
    const wide = previous !== undefined && word.x0 - previous.x1 > line.height * 1.5;
    const marker = /^(CR|DR)$/i.test(word.text) && isMoney(previous);
    // An amount, or a sign about to be joined to one, starts a cell of its own; a CR or DR
    // after it ends it.
    if (!marker && (wide || signOfNext || (isMoney(word) && !isSign(previous)))) close();
    current.push(word);
    if (marker || (isMoney(word) && !/^(CR|DR)$/i.test(next?.text ?? ""))) close();
  }
  close();
  return cells;
}

// ---- amounts

/**
 * An amount as banks show them, or null: `-$1,234.56`, `$12.00`, `(4.50)`, `+3.20`,
 * `12.00 CR`. A colon or a stray dot where a comma belongs is read as one, as text
 * recognition often mistakes them. Two decimal places are required, so an account number
 * or a store number is never an amount.
 */
export function parseMoney(text: string): { cents: number; sign: "-" | "+" | null } | null {
  const compact = text.replace(/\s+/g, "").replace(/[−–—]/g, "-");
  const match = /^([-+])?(\()?([-+])?\$?(\d[\d,.:']*)[.,](\d{2})(\))?(CR|DR)?$/i.exec(compact);
  if (!match) return null;
  const [, lead, open, inner, whole, fraction, close, marker] = match;
  if (Boolean(open) !== Boolean(close)) return null;
  const digits = whole!.replace(/[,.:']/g, "");
  if (digits.length > 9) return null;
  const cents = Number(digits) * 100 + Number(fraction);
  const signText = lead ?? inner;
  const sign = signText === "-" || open || marker?.toUpperCase() === "DR" ? "-" : signText === "+" || marker?.toUpperCase() === "CR" ? "+" : null;
  return { cents, sign };
}

// ---- dates

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (word: string) => {
  const key = word.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  const index = MONTHS.indexOf(key);
  return index === -1 || word.replace(/[^a-z]/gi, "").length > 9 ? null : index + 1;
};
const pad = (value: number) => String(value).padStart(2, "0");

/** A calendar date, or null when it doesn't exist. */
function makeDate(year: number, month: number, day: number): LocalDate | null {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  return isLocalDate(date) ? date : null;
}

/** With no year shown: the latest such date that is not after today. */
function withoutYear(month: number, day: number, today: LocalDate): LocalDate | null {
  const year = Number(today.slice(0, 4));
  const thisYear = makeDate(year, month, day);
  return thisYear && thisYear <= today ? thisYear : makeDate(year - 1, month, day);
}

/**
 * A date written the ways banks write them, or null: `Oct 10, 2026`, `Oct10,2026`,
 * `October 10 2026`, `10 Oct 2026`, `10/10/2026` and `10/10/26` (month first), `2026-10-10`,
 * `Oct 10` and `10/10` (the latest that is not in the future), `Today`, `Yesterday`.
 */
export function parseDate(text: string, today: LocalDate): LocalDate | null {
  const plain = text.trim().replace(/\s+/g, " ").replace(/[.,]$/, "");
  if (/^today$/i.test(plain)) return today;
  if (/^yesterday$/i.test(plain)) return addDays(today, -1);

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(plain);
  if (match) return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(plain);
  if (match) {
    const [month, day] = [Number(match[1]), Number(match[2])];
    if (!match[3]) return withoutYear(month, day, today);
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return makeDate(year, month, day);
  }

  // Month name first: "Oct 10, 2026", "Oct10,2026", "October 10".
  match = /^([a-z]{3,9})\.?\s?(\d{1,2})(?:(?:,\s?|\s)(\d{4}))?$/i.exec(plain);
  if (match && monthOf(match[1]!)) {
    const [month, day] = [monthOf(match[1]!)!, Number(match[2])];
    return match[3] ? makeDate(Number(match[3]), month, day) : withoutYear(month, day, today);
  }
  // Day first: "10 Oct 2026", "10 October".
  match = /^(\d{1,2})\s?([a-z]{3,9})\.?(?:,?\s(\d{4}))?$/i.exec(plain);
  if (match && monthOf(match[2]!)) {
    const [month, day] = [monthOf(match[2]!)!, Number(match[1])];
    return match[3] ? makeDate(Number(match[3]), month, day) : withoutYear(month, day, today);
  }
  return null;
}

/** What part of a date a cell is, when it is only that: "OCT", "10", "2026". */
function datePart(text: string): "month" | "day" | "year" | null {
  const plain = text.trim();
  if (/^[a-z]{3,9}\.?$/i.test(plain) && monthOf(plain)) return "month";
  if (/^\d{1,2}$/.test(plain) && Number(plain) >= 1 && Number(plain) <= 31) return "day";
  if (/^(19|20)\d{2}$/.test(plain)) return "year";
  return null;
}

// ---- clutter

// Words some banks put on every row that are not part of what the transaction is called.
const CLUTTER = /^(add a category|pending|posted|processing|uncategori[sz]ed|details?)$/i;

/** The description as shown, less stray marks and a cut-off ellipsis. */
function cleanName(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .join(" ")
    .replace(/(\.\.\.|…)$/, "")
    .replace(/^[^a-z0-9#]+|[^a-z0-9)]+$/gi, "")
    .trim();
}

// ---- transactions

type Block = { lines: Line[]; cells: Cell[] };

/** Groups lines into blocks wherever the space between two lines is wider than a line. */
function toBlocks(lines: Line[]): Block[] {
  const threshold = median(lines.map((line) => line.height)) * 0.9;
  const blocks: Block[] = [];
  let bottom = -Infinity;
  for (const line of lines) {
    if (blocks.length === 0 || line.y0 - bottom > threshold) blocks.push({ lines: [], cells: [] });
    const block = blocks.at(-1)!;
    block.cells.push(...toCells(line, block.lines.length));
    block.lines.push(line);
    bottom = Math.max(bottom, line.y1);
  }
  return blocks;
}

type Draft = Omit<ScannedRow, "amountCents" | "flags"> & {
  amount: { cents: number; sign: "-" | "+" | null };
  flags: Set<ScanFlag>;
};

/** The block's date: one cell that says it all, or a month, day and year stacked in a column. */
function blockDate(cells: Cell[], today: LocalDate): { date: LocalDate | null; dateCells: Set<Cell>; partial: boolean } {
  const dateCells = new Set<Cell>();
  for (const cell of cells) {
    const date = parseDate(cell.text, today);
    if (date) return { date, dateCells: new Set([cell]), partial: false };
  }
  const parts: Partial<Record<"month" | "day" | "year", number>> = {};
  for (const cell of cells) {
    const part = datePart(cell.text);
    if (!part || parts[part] !== undefined) continue;
    parts[part] = part === "month" ? monthOf(cell.text)! : Number(cell.text);
    dateCells.add(cell);
  }
  if (parts.month && parts.day) {
    const date = parts.year ? makeDate(parts.year, parts.month, parts.day) : withoutYear(parts.month, parts.day, today);
    return { date, dateCells, partial: date === null };
  }
  return { date: null, dateCells, partial: parts.month !== undefined || parts.year !== undefined };
}

/**
 * The transactions in a screenshot, top to bottom, from the words text recognition found
 * in it. `today` is the budget's today, for dates shown without a year.
 */
export function rowsFromWords(words: readonly OcrWord[], today: LocalDate): ScannedRow[] {
  const drafts: Draft[] = [];
  let heading: LocalDate | null = null;

  for (const { cells } of toBlocks(toLines(words))) {
    const money = cells.filter((cell) => parseMoney(cell.text) !== null);
    const { date, dateCells, partial } = blockDate(cells, today);
    // An amount too garbled to read ("-$1/5.00") is not part of the name either.
    const garbledAmount = (cell: Cell) => /^[-−–+(]?\$/.test(cell.text.trim());
    const text = cells.filter(
      (cell) => !money.includes(cell) && !dateCells.has(cell) && !CLUTTER.test(cell.text.trim()) && !garbledAmount(cell),
    );
    const name = cleanName(text.map((cell) => cell.text).join(" "));

    if (money.length === 0) {
      // A date with nothing else is a heading for the rows under it ("Today", "Oct 10").
      if (date && !/[a-z]{2}/i.test(name)) heading = date;
      continue;
    }

    // Two amounts on one line: the amount, then the balance to its right. Stacked: the
    // amount over the balance.
    const sameLine = money.find((cell, index) => money.some((other, otherIndex) => otherIndex !== index && other.line === cell.line));
    const amountCell = sameLine ? money.filter((cell) => cell.line === sameLine.line).sort((a, b) => a.x0 - b.x0)[0]! : money[0]!;
    const balanceCell = sameLine
      ? money.filter((cell) => cell.line === sameLine.line && cell.x0 > amountCell.x0).sort((a, b) => a.x0 - b.x0)[0]
      : money[1];

    // Stray marks ("~~", "°") are left out of the name, and of how sure the reading was.
    const read = [...text.flatMap((cell) => cell.words), ...amountCell.words].filter((word) => /[a-z0-9]/i.test(word.text));
    const confidence = Math.round(Math.min(...read.map((word) => word.confidence)));
    const flags = new Set<ScanFlag>();
    if (confidence < LOW_CONFIDENCE || !name) flags.add("hard_to_read");
    const rowDate = date ?? (partial ? null : heading);
    if (!rowDate) flags.add("no_date");

    drafts.push({
      date: rowDate,
      name,
      amount: parseMoney(amountCell.text)!,
      balanceCents: balanceCell ? parseMoney(balanceCell.text)!.cents : null,
      confidence,
      flags,
    });
  }

  // A bank that marks spending with a minus shows money in unmarked; with no minus
  // anywhere, an unmarked amount is spending (a card statement).
  const marksSpending = drafts.some((draft) => draft.amount.sign === "-");
  return drafts.map(({ amount, flags, ...row }) => {
    const out = amount.sign === "-" || (amount.sign === null && !marksSpending);
    return { ...row, amountCents: out ? -amount.cents : amount.cents, flags: [...flags] };
  });
}

/**
 * The words as lines of text top to bottom, with the gaps between columns shown as " | "
 * and each line's height on the page: what a model is given to read instead of a picture.
 */
export function describeLayout(words: readonly OcrWord[]): string {
  return toLines(words)
    .map((line, index) => `y=${Math.round(line.y0)}: ${toCells(line, index).map((cell) => cell.text).join(" | ")}`)
    .join("\n");
}

/**
 * The key a scanned row is imported under, so the same row read again later is skipped:
 * only when the screenshot shows a running balance, which tells two like rows apart.
 */
export function scanImportKey(row: Pick<ScannedRow, "date" | "amountCents" | "balanceCents">): string | undefined {
  return row.date && row.balanceCents !== null ? `scan:${row.date}:${row.amountCents}:${row.balanceCents}` : undefined;
}

/**
 * Rows from several screenshots as one list. A row that a later screenshot repeats is kept
 * once: the same amount and balance (and date, where both copies have one), or with no
 * balance the same date, amount and name. The copy kept is the one with a date, then the
 * better read. Two like rows within one screenshot are both kept.
 */
export function mergeScans(screenshots: ReadonlyArray<readonly ScannedRow[]>): ScannedRow[] {
  const merged: Array<{ row: ScannedRow; from: number }> = [];
  const sameRow = (a: ScannedRow, b: ScannedRow) =>
    a.amountCents === b.amountCents &&
    (a.balanceCents !== null && b.balanceCents !== null
      ? a.balanceCents === b.balanceCents && (a.date === null || b.date === null || a.date === b.date)
      : a.date === b.date && a.name.toLowerCase() === b.name.toLowerCase());
  const better = (a: ScannedRow, b: ScannedRow) =>
    (a.date !== null) !== (b.date !== null) ? a.date !== null : a.confidence > b.confidence;
  for (const [from, rows] of screenshots.entries()) {
    for (const row of rows) {
      const twin = merged.find((entry) => entry.from !== from && sameRow(entry.row, row));
      if (!twin) merged.push({ row, from });
      else if (better(row, twin.row)) twin.row = row;
    }
  }
  return merged.map((entry) => entry.row);
}
